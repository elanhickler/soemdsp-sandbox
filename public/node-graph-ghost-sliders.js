function nodeGraphSliderForParameter(node, key) {
  // Map lookup (rebuilt when the patch / slider DOM changes) instead of a
  // document querySelector + child querySelector per ghost per frame.
  const entry = nodeGraphGhostSliderEntryFor(node, key);
  if (entry) {
    return entry.slider;
  }
  return nodeGraphNodeElement(node)?.querySelector(
    `input[data-param="${CSS.escape(key)}"]`,
  );
}

// param -> slider map. Rebuilt when the patch object, node / modulation
// lists, or the slider DOM (readout count, a detached cached slider) change.
let nodeGraphGhostSliderMap = null;
let nodeGraphGhostSliderReadoutCollection = null;

function nodeGraphGhostSliderMapKey(node, key) {
  return `${String(node || "")}\u0000${String(key || "")}`;
}

function nodeGraphGhostSliderMapIsCurrent(map) {
  if (!map || typeof document === "undefined") {
    return false;
  }
  const patch = nodeGraphMvp?.patch;
  if (
    map.patch !== patch
    || map.nodes !== patch?.nodes
    || map.nodeCount !== (patch?.nodes?.length || 0)
    || map.modulations !== patch?.modulations
    || map.modulationCount !== (patch?.modulations?.length || 0)
    || map.readoutCount !== (nodeGraphGhostSliderReadoutCollection?.length || 0)
  ) {
    return false;
  }
  for (let i = 0; i < map.entries.length; i += 1) {
    const entry = map.entries[i];
    if (!entry.slider.isConnected || entry.slider.dataset.param !== entry.key) {
      return false;
    }
  }
  return true;
}

function nodeGraphGhostSliderBuildMap() {
  if (!nodeGraphGhostSliderReadoutCollection && typeof document.getElementsByClassName === "function") {
    nodeGraphGhostSliderReadoutCollection = document.getElementsByClassName("node-slider-readout");
  }
  const patch = nodeGraphMvp?.patch;
  const byKey = new Map();
  const entries = [];
  for (const slider of document.querySelectorAll(".dsp-node input[data-param]")) {
    const node = slider.closest(".dsp-node")?.dataset.node;
    const key = slider.dataset.param;
    const readout = slider.closest("label")?.querySelector(".node-slider-readout");
    if (!node || !key) {
      continue;
    }
    const entry = { key, node, readout: readout || null, slider };
    entries.push(entry);
    const mapKey = nodeGraphGhostSliderMapKey(node, key);
    // querySelector semantics: first slider in document order wins.
    if (!byKey.has(mapKey)) {
      byKey.set(mapKey, entry);
    }
  }
  return {
    byKey,
    entries,
    modulationCount: patch?.modulations?.length || 0,
    modulations: patch?.modulations,
    nodeCount: patch?.nodes?.length || 0,
    nodes: patch?.nodes,
    patch,
    readoutCount: nodeGraphGhostSliderReadoutCollection?.length || 0,
    targets: null,
  };
}

// Validity is checked once per animation frame: many lookups per frame
// (ghost sync, filter curves, Metronome BPM) run in separate rAF callbacks
// and share one check. Without a frame clock, once per task.
let nodeGraphGhostSliderMapCheckedThisTask = false;
let nodeGraphGhostSliderMapCheckedStamp = null;

function nodeGraphGhostSliderFrameStamp() {
  const t = typeof document !== "undefined" ? document.timeline?.currentTime : null;
  return Number.isFinite(t) ? t : null;
}

function nodeGraphGhostSliderCurrentMap() {
  if (
    typeof document === "undefined"
    || typeof document.querySelectorAll !== "function"
    || typeof document.getElementsByClassName !== "function"
  ) {
    return null;
  }
  const stamp = nodeGraphGhostSliderFrameStamp();
  if (
    nodeGraphGhostSliderMap
    && nodeGraphGhostSliderMap.patch === nodeGraphMvp?.patch
    && nodeGraphGhostSliderMap.modulationCount === (nodeGraphMvp?.patch?.modulations?.length || 0)
    && (nodeGraphGhostSliderMapCheckedThisTask
      || (stamp !== null && stamp === nodeGraphGhostSliderMapCheckedStamp))
  ) {
    return nodeGraphGhostSliderMap;
  }
  if (!nodeGraphGhostSliderMapIsCurrent(nodeGraphGhostSliderMap)) {
    nodeGraphGhostSliderMap = nodeGraphGhostSliderBuildMap();
  }
  nodeGraphGhostSliderMapCheckedStamp = stamp;
  if (stamp === null && typeof queueMicrotask === "function") {
    nodeGraphGhostSliderMapCheckedThisTask = true;
    queueMicrotask(() => {
      nodeGraphGhostSliderMapCheckedThisTask = false;
    });
  }
  return nodeGraphGhostSliderMap;
}

function nodeGraphGhostSliderEntryFor(node, key) {
  const map = nodeGraphGhostSliderCurrentMap();
  const entry = map ? map.byKey.get(nodeGraphGhostSliderMapKey(node, key)) || null : null;
  // A slider swapped out mid-task: fall back to a fresh DOM lookup.
  return entry && entry.slider.isConnected ? entry : null;
}

/** Modulation destinations (node + param) that can carry a ghost. */
function nodeGraphGhostSliderTargets(map) {
  if (map.targets) {
    return map.targets;
  }
  const targets = new Set();
  for (const modulation of nodeGraphMvp?.patch?.modulations || []) {
    const destNode = String(modulation?.destinationNode || "");
    const destParam = String(modulation?.destinationParam || "");
    if (destNode && destParam) {
      targets.add(nodeGraphGhostSliderMapKey(destNode, destParam));
    }
  }
  map.targets = targets;
  return targets;
}

/** Could nodeGraphParameterGhostSignal return non-null for this slider? */
function nodeGraphGhostSliderIsCandidate(map, entry) {
  if (nodeGraphGhostSliderTargets(map).has(nodeGraphGhostSliderMapKey(entry.node, entry.key))) {
    return true;
  }
  // Root face mx_* rows ghost via cables into the exposed child param.
  return entry.key.startsWith("mx_");
}

function nodeGraphNormalizedParameterSignalBounds(signal, metadata = {}) {
  return metadata.wraparound
    ? wrapNodeSliderValue(nodeGraphFiniteNumber(signal), 0, 1)
    : clampNodeSliderValue(nodeGraphFiniteNumber(signal), 0, 1);
}

/** Last posted scope sample for exact `nodeId:port` only.
 *  Cable ghosts must use the jack name (Left/Right/Out) — never a face Raw
 *  probe sibling and never Out/face aggregate remaps.
 */
function nodeGraphGhostSliderScopeSample(nodeId, port) {
  const id = String(nodeId || "").trim();
  const name = String(port || "").trim();
  if (!id || !name || typeof nodeGraphModuleScopeState === "undefined") {
    return null;
  }
  const buffer = nodeGraphModuleScopeState?.buffers?.get?.(`${id}:${name}`);
  if (!buffer?.length) {
    return null;
  }
  // Prefer the newest finite sample (same spirit as LatestOutputValue).
  for (let index = buffer.length - 1; index >= 0; index -= 1) {
    const sample = Number(buffer[index]);
    if (Number.isFinite(sample)) {
      return sample;
    }
  }
  return null;
}

/**
 * Cheap MOD sample for a ghost: last scope frame if we already have it,
 * else (for parameter ports) the THRU of that param's MOD input.
 * Does not request new capture — no extra buffers.
 */
function nodeGraphGhostSliderControllerOutSample(nodeId, port) {
  const p = String(port || "").trim();
  if (p !== "Out" && p !== "Bias") {
    return null;
  }
  const type = typeof nodeGraphPatchNodeType === "function"
    ? nodeGraphPatchNodeType(nodeId)
    : "";
  if (
    type !== "toggleButton"
    && type !== "momentaryButton"
    && type !== "knob"
    && type !== "pluginSlider"
    && type !== "playerMode"
  ) {
    return null;
  }
  // Prefer live Bias/Out when scope has it (efficient peel / full JS).
  if (typeof nodeGraphModuleScopeLatestOutputValue === "function") {
    const live = Number(nodeGraphModuleScopeLatestOutputValue(nodeId, p, Number.NaN));
    if (Number.isFinite(live)) {
      return live;
    }
    if (p === "Out") {
      const bias = Number(nodeGraphModuleScopeLatestOutputValue(nodeId, "Bias", Number.NaN));
      if (Number.isFinite(bias)) return bias;
    }
  }
  const read = (key, fallback) => {
    const n = typeof nodeGraphReadNodeNumber === "function"
      ? Number(nodeGraphReadNodeNumber(nodeId, key))
      : Number.NaN;
    return Number.isFinite(n) ? n : fallback;
  };
  const patchNode = typeof nodeGraphPatchNode === "function"
    ? nodeGraphPatchNode(nodeId)
    : null;
  const domain = typeof nodeGraphDspControllerBiasTarget === "function"
    ? nodeGraphDspControllerBiasTarget(patchNode, "offset", read("offset", 0))
    : read("offset", 0);
  if (type === "knob" || type === "pluginSlider") {
    const range = typeof nodeGraphDspKnobOffsetDomain === "function"
      ? nodeGraphDspKnobOffsetDomain(patchNode)
      : null;
    if (range) {
      const lo = Number(range.min);
      const hi = Number(range.max);
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        return domain < lo ? lo : (domain > hi ? hi : domain);
      }
    }
    return domain;
  }
  const ends = typeof nodeGraphDspControllerBiasEnds === "function"
    ? nodeGraphDspControllerBiasEnds(patchNode, "offset")
    : null;
  if (ends) {
    const lo = Number(ends.min);
    const hi = Number(ends.max);
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      return domain < lo ? lo : (domain > hi ? hi : domain);
    }
  }
  return domain;
}

function nodeGraphGhostSliderModSample(sourceNode, sourcePort, depth = 0) {
  const port = String(sourcePort || "").trim();
  const scoped = nodeGraphGhostSliderScopeSample(sourceNode, port);
  if (scoped != null) {
    return scoped;
  }
  const nodeId = String(sourceNode || "").trim();
  if (!nodeId || !port) {
    return null;
  }
  // 1D Phosphor Thru (and other monitor thrus): no scope on Thru — sample In's upstream.
  if (depth < 6 && (port === "Thru" || port === "←")) {
    const sourceType = typeof nodeGraphPatchNodeType === "function"
      ? nodeGraphPatchNodeType(nodeId)
      : "";
    let inPort = "In";
    if (typeof nodeGraphModuleBypassPortMap === "function" && sourceType) {
      const map = nodeGraphModuleBypassPortMap(sourceType) || [];
      for (let i = 0; i < map.length; i += 1) {
        if (String(map[i]?.out || "") === port && map[i]?.in) {
          inPort = String(map[i].in);
          break;
        }
      }
    }
    const conns = nodeGraphMvp?.patch?.connections || [];
    for (let i = 0; i < conns.length; i += 1) {
      const c = conns[i];
      if (String(c?.destinationNode || "") !== nodeId) continue;
      if (String(c?.destinationPort || "") !== inPort) continue;
      const up = nodeGraphGhostSliderModSample(c.sourceNode, c.sourcePort, depth + 1);
      if (up != null && Number.isFinite(Number(up))) return up;
    }
    // Face may still have In scope even with no Thru buffer.
    const inScoped = nodeGraphGhostSliderScopeSample(nodeId, inPort);
    if (inScoped != null) return inScoped;
  }
  // Named Portal Out: chromeless / spliced — no Out scope. Walk the Title bus
  // like nodeGraphEvaluateNamedPortalOut and sample each Portal In upstream.
  if (depth < 6 && (port === "Out" || port === "←" || port === "Mono")) {
    const portalNode = typeof nodeGraphPatchNode === "function"
      ? nodeGraphPatchNode(nodeId)
      : null;
    const isPortalOut = typeof nodeGraphIsNamedPortalOutType === "function"
      ? nodeGraphIsNamedPortalOutType(portalNode?.type)
      : String(portalNode?.type || "") === "namedPortalOut";
    if (isPortalOut) {
      const key = typeof nodeGraphNamedPortalBusKey === "function"
        ? nodeGraphNamedPortalBusKey(portalNode)
        : String(portalNode?.alias || "").trim().toLowerCase();
      const universe = typeof nodeGraphNamedPortalUniverse === "function"
        ? nodeGraphNamedPortalUniverse(portalNode)
        : String(portalNode?.ownerMetamoduleId || "").trim();
      if (key) {
        const nodes = nodeGraphMvp?.patch?.nodes || [];
        const conns = nodeGraphMvp?.patch?.connections || [];
        let sum = 0;
        let any = false;
        for (let i = 0; i < nodes.length; i += 1) {
          const other = nodes[i];
          if (
            !other
            || other.bypassed
            || !(typeof nodeGraphIsNamedPortalInType === "function"
              ? nodeGraphIsNamedPortalInType(other.type)
              : String(other.type) === "namedPortalIn")
          ) {
            continue;
          }
          const otherKey = typeof nodeGraphNamedPortalBusKey === "function"
            ? nodeGraphNamedPortalBusKey(other)
            : String(other?.alias || "").trim().toLowerCase();
          const otherUni = typeof nodeGraphNamedPortalUniverse === "function"
            ? nodeGraphNamedPortalUniverse(other)
            : String(other?.ownerMetamoduleId || "").trim();
          if (otherKey !== key || otherUni !== universe) continue;
          const inScoped = nodeGraphGhostSliderScopeSample(other.id, "In");
          if (inScoped != null && Number.isFinite(Number(inScoped))) {
            sum += Number(inScoped);
            any = true;
            continue;
          }
          for (let j = 0; j < conns.length; j += 1) {
            const c = conns[j];
            if (String(c?.destinationNode || "") !== String(other.id)) continue;
            if (String(c?.destinationPort || "") !== "In") continue;
            const up = nodeGraphGhostSliderModSample(
              c.sourceNode,
              c.sourcePort,
              depth + 1,
            );
            if (up != null && Number.isFinite(Number(up))) {
              sum += Number(up);
              any = true;
            }
          }
        }
        if (any) {
          return sum;
        }
      }
    }
  }
  const fromController = nodeGraphGhostSliderControllerOutSample(nodeId, port);
  if (fromController != null && Number.isFinite(fromController)) {
    return fromController;
  }
  const sourceType = typeof nodeGraphPatchNodeType === "function"
    ? nodeGraphPatchNodeType(nodeId)
    : null;
  if (!sourceType || typeof nodeGraphParameterOutputPort !== "function") {
    return null;
  }
  if (!nodeGraphParameterOutputPort(sourceType, port)) {
    // Audio/CV with no posted frame yet — skip rather than invent a value.
    // Do not fall back to nodeId / face aggregate (would sample Ext Out or a
    // Raw face probe when Left/Right rings are briefly empty).
    return null;
  }
  // Parameter out = THRU of this param's MOD input. Nothing wired = no signal.
  if (depth >= 6) {
    return null;
  }
  let thruSum = 0;
  let thruAny = false;
  for (const m of nodeGraphMvp?.patch?.modulations || []) {
    if (String(m?.destinationNode || "") !== nodeId) continue;
    if (String(m?.destinationParam || "") !== port) continue;
    const up = nodeGraphGhostSliderModSample(m.sourceNode, m.sourcePort, depth + 1);
    if (up != null && Number.isFinite(Number(up))) {
      thruSum += Number(up);
      thruAny = true;
    }
  }
  return thruAny ? thruSum : null;
}

function nodeGraphParameterGhostModulationMatches(modulation, patchNode, key) {
  const destNode = String(modulation?.destinationNode || "");
  const destParam = String(modulation?.destinationParam || "");
  const id = String(patchNode?.id || "");
  const param = String(key || "");
  if (!destNode || !destParam || !id || !param) {
    return false;
  }
  if (destNode === id && destParam === param) {
    return true;
  }
  // Root face: cables into an owned child still ghost on the exposed mx_* row.
  if (
    param.startsWith("mx_")
    && typeof nodeGraphMetamoduleResolveExposeTarget === "function"
    && typeof nodeGraphIsContainerShellType === "function"
    && nodeGraphIsContainerShellType(patchNode?.type)
  ) {
    const resolved = nodeGraphMetamoduleResolveExposeTarget(patchNode, param);
    if (
      resolved
      && destNode === String(resolved.childId || "")
      && destParam === String(resolved.paramKey || "")
    ) {
      return true;
    }
  }
  return false;
}

function nodeGraphParameterGhostSignal(node, key, sliderHint = null) {
  const patchNode = nodeGraphPatchNode(node);
  if (!patchNode) {
    return null;
  }
  const metadata = nodeGraphReadPatchParameterMetadata(patchNode, key) || {};
  const targetSlider = sliderHint && sliderHint.isConnected
    ? sliderHint
    : nodeGraphSliderForParameter(node, key);
  const baseDomain = targetSlider
    ? nodeGraphReadNodeNumber(node, key)
    : nodeGraphReadPatchParameterValue(patchNode, key);
  const sources = [];
  for (const modulation of nodeGraphMvp.patch.modulations || []) {
    if (!nodeGraphParameterGhostModulationMatches(modulation, patchNode, key)) {
      continue;
    }
    const sample = nodeGraphGhostSliderModSample(
      modulation.sourceNode,
      modulation.sourcePort,
    );
    if (sample == null) {
      continue;
    }
    let normalized;
    if (typeof nodeGraphParamNormalizeModInput === "function") {
      normalized = nodeGraphParamNormalizeModInput(sample, metadata);
    } else {
      const n = Number(sample);
      normalized = Number.isFinite(n) ? n : 0;
    }
    // Range Out is unit CV. Native ParamModEdge maps it across the
    // destination param min/max. Tagging every Range as domain made a
    // 1-to-0 map read as 1 Hz to 0 Hz on Attack (0 to 20000 Hz).
    // A parameter-out is a thru with no units of its own; destination
    // outputDomain still means real units.
    const taggedDomain = metadata.outputDomain === true;
    sources.push(taggedDomain ? { value: Number(normalized), domain: true } : normalized);
  }
  if (!sources.length) {
    return null;
  }
  let effective = nodeGraphFiniteNumber(baseDomain);
  if (typeof nodeGraphParamFoldModSources === "function") {
    effective = nodeGraphParamFoldModSources(effective, sources, metadata);
  } else if (typeof nodeGraphApplyParameterModulation === "function") {
    const modSum = sources.reduce((sum, value) => {
      const n = Number(value && typeof value === "object" ? value.value : value);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
    effective = nodeGraphApplyParameterModulation(effective, modSum, metadata);
  } else {
    const baseUnit = nodeGraphParameterValueToNormalizedSignal(effective, metadata);
    const contrib = sources.reduce((sum, value) => {
      const n = Number(value && typeof value === "object" ? value.value : value);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
    return {
      signal: nodeGraphNormalizedParameterSignalBounds(baseUnit + contrib, metadata),
      effectiveDomain: effective,
    };
  }
  // Ghost position uses unit mapped into min/max zoom window (may clip visually).
  // effectiveDomain is the value actually sent (unclipped under domain REPLACE).
  let signal;
  if (typeof nodeGraphParamDomainToUnit === "function") {
    signal = nodeGraphNormalizedParameterSignalBounds(
      nodeGraphParamDomainToUnit(effective, metadata),
      metadata,
    );
  } else {
    signal = nodeGraphNormalizedParameterSignalBounds(
      nodeGraphParameterValueToNormalizedSignal(effective, metadata),
      metadata,
    );
  }
  return { signal, effectiveDomain: effective };
}

let nodeGraphGhostSliderLiveFrame = 0;
let nodeGraphGhostSliderHadAny = false;
let nodeGraphGhostSliderLastLiveSyncMs = 0;
// Live (scope-snapshot driven) ghost refresh cap. Drag / input stay ungated.
const nodeGraphGhostSliderLiveMinIntervalMs = 1000 / 30;

function nodeGraphGhostSliderClearEntry(slider, readout) {
  slider._nodeGraphGhostLast = null;
  if (!readout) {
    return;
  }
  readout.classList.toggle("has-ghost-slider", false);
  readout.style.removeProperty("--ghost-start");
  readout.style.removeProperty("--ghost-end");
  if (Object.hasOwn(slider.dataset, "sentDomainValue")) {
    delete slider.dataset.sentDomainValue;
    // Restore in-slider number to editable base (no ghost target).
    if (typeof syncNodeSliderReadout === "function") {
      syncNodeSliderReadout(slider);
    }
  }
}

function syncNodeGraphGhostSliders() {
  const mods = nodeGraphMvp?.patch?.modulations;
  if (!mods?.length) {
    if (!nodeGraphGhostSliderHadAny) {
      return;
    }
    for (const readout of document.querySelectorAll(".node-slider-readout.has-ghost-slider")) {
      readout.classList.remove("has-ghost-slider");
      readout.style.removeProperty("--ghost-start");
      readout.style.removeProperty("--ghost-end");
      const slider = document.getElementById(readout.dataset.sliderTarget)
        || readout.closest("label")?.querySelector("input[data-param]");
      if (slider) {
        slider._nodeGraphGhostLast = null;
        delete slider.dataset.sentDomainValue;
        if (typeof syncNodeSliderReadout === "function") {
          syncNodeSliderReadout(slider);
        }
      }
    }
    nodeGraphGhostSliderHadAny = false;
    return;
  }
  let any = false;
  const map = nodeGraphGhostSliderCurrentMap() || (
    typeof document !== "undefined" && typeof document.querySelectorAll === "function"
      ? nodeGraphGhostSliderBuildMap()
      : null
  );
  if (map) {
    // Modulation edits can rewrite a destination in place; rebuild the small
    // target set on every sync (the slider map itself stays cached).
    map.targets = null;
  }
  for (const entry of map?.entries || []) {
    const { slider, readout, node, key } = entry;
    if (!readout) {
      continue;
    }
    // Sliders no modulation can reach: nothing to compute. Only clear a ghost
    // left over from before the modulation was removed.
    if (!nodeGraphGhostSliderIsCandidate(map, entry)) {
      if (
        slider._nodeGraphGhostLast
        || readout.classList.contains("has-ghost-slider")
        || Object.hasOwn(slider.dataset, "sentDomainValue")
      ) {
        if (
          typeof nodeGraphElementInSkippedContentVisibility === "function"
          && nodeGraphElementInSkippedContentVisibility(slider)
        ) {
          continue;
        }
        nodeGraphGhostSliderClearEntry(slider, readout);
      }
      continue;
    }
    if (
      typeof nodeGraphElementInSkippedContentVisibility === "function"
      && nodeGraphElementInSkippedContentVisibility(slider)
    ) {
      continue;
    }
    const ghost = nodeGraphParameterGhostSignal(node, key, slider);
    const ghostSignal = ghost && typeof ghost === "object" && "signal" in ghost
      ? ghost.signal
      : ghost;
    if (ghostSignal === null) {
      nodeGraphGhostSliderClearEntry(slider, readout);
      continue;
    }
    any = true;
    // Thumb stays on editable domainValue; ghost CSS + in-slider number show
    // the modulated *target* (effectiveDomain). Do not model smoothing.
    const effective = ghost && typeof ghost === "object" && Number.isFinite(Number(ghost.effectiveDomain))
      ? String(ghost.effectiveDomain)
      : null;
    const range = nodeSliderHandleRangeFromTravel(
      slider,
      readout,
      clampNodeSliderValue(ghostSignal, 0, 1),
    );
    // Skip unchanged: same ghost range, same target number, same base value
    // and the readout still carries the ghost (a re-render would drop it).
    const last = slider._nodeGraphGhostLast;
    const sentNow = effective ?? slider.dataset.sentDomainValue ?? null;
    if (
      last
      && last.readout === readout
      && last.start === range.start
      && last.end === range.end
      && last.sent === sentNow
      && last.base === slider.dataset.domainValue
      && last.value === slider.value
      && readout.classList.contains("has-ghost-slider")
      && (effective === null || slider.dataset.sentDomainValue === effective)
    ) {
      continue;
    }
    readout.classList.toggle("has-ghost-slider", true);
    if (effective !== null) {
      slider.dataset.sentDomainValue = effective;
    }
    readout.style.setProperty("--ghost-start", `${range.start}px`);
    readout.style.setProperty("--ghost-end", `${range.end}px`);
    // Refresh numeric readout to sent/target (syncNodeSliderReadout prefers
    // sentDomainValue for the number; thumb still uses base domainValue).
    if (typeof syncNodeSliderReadout === "function") {
      syncNodeSliderReadout(slider);
    }
    slider._nodeGraphGhostLast = {
      base: slider.dataset.domainValue,
      end: range.end,
      readout,
      sent: slider.dataset.sentDomainValue ?? null,
      start: range.start,
      value: slider.value,
    };
  }
  nodeGraphGhostSliderHadAny = any;
}

function scheduleNodeGraphGhostSlidersFromLive() {
  if (nodeGraphGhostSliderLiveFrame) {
    return;
  }
  nodeGraphGhostSliderLiveFrame = window.requestAnimationFrame(() => {
    nodeGraphGhostSliderLiveFrame = 0;
    // Live mod ghosts share Simulation FPS. Mouse drag / input call
    // syncNodeGraphGhostSliders() directly (ungated) for immediate feedback.
    if (
      typeof nodeGraphSimFpsShouldPaint === "function"
      && !nodeGraphSimFpsShouldPaint("__ghost-sliders", false)
    ) {
      if (typeof nodeGraphSimFpsRate === "function" && !(nodeGraphSimFpsRate() > 0)) {
        return;
      }
      scheduleNodeGraphGhostSlidersFromLive();
      return;
    }
    // Cap live refresh at ~30 Hz; keep the frame armed so the next due
    // frame still runs.
    const nowMs = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    if (nowMs - nodeGraphGhostSliderLastLiveSyncMs < nodeGraphGhostSliderLiveMinIntervalMs - 1) {
      scheduleNodeGraphGhostSlidersFromLive();
      return;
    }
    nodeGraphGhostSliderLastLiveSyncMs = nowMs;
    syncNodeGraphGhostSliders();
  });
}

if (typeof addNodeGraphModuleScopeSnapshotListener === "function") {
  addNodeGraphModuleScopeSnapshotListener(scheduleNodeGraphGhostSlidersFromLive);
}
