// Knob module face: native WebGL dial (modules/_shared/controller-face-gl.js).
// Ring track + value arc (from the low end, or from 0 when the Bias range is
// bipolar), a thumb at the value, a cap, label and number in GL text, and the
// modulation ghost as a dot on the ring clamped to the Bias range.
// Input stays in DOM: the face is the Bias drag surface (same path as the
// .node-slider-readout), double-click types a value, the label is a
// transparent click-to-edit span laid over the drawn label.

const NODE_GRAPH_KNOB_FACE_LABEL_TEXT_MAX = 48;

function nodeGraphKnobFaceNormalizeLabelText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, NODE_GRAPH_KNOB_FACE_LABEL_TEXT_MAX);
}

function nodeGraphKnobDisplayNameForNode(node) {
  const settings = nodeGraphControllerFaceSettingsForNode(node);
  return nodeGraphKnobFaceNormalizeLabelText(settings?.labelText);
}

function nodeGraphKnobTitleForNode(node) {
  return typeof normalizeNodeGraphPatchNodeAlias === "function"
    ? normalizeNodeGraphPatchNodeAlias(node?.alias)
    : String(node?.alias || "").trim();
}

function nodeGraphKnobModuleTitleForNode(node) {
  const alias = nodeGraphKnobTitleForNode(node);
  if (alias) {
    return alias;
  }
  if (typeof nodeGraphDefaultNodeTitle === "function") {
    return String(nodeGraphDefaultNodeTitle(node?.type, node?.id) || "").trim();
  }
  return String(nodeGraphNodeLabels?.[node?.type] || node?.type || "").trim();
}

function nodeGraphKnobResolvedDisplayNameForNode(node) {
  return nodeGraphKnobDisplayNameForNode(node) || nodeGraphKnobModuleTitleForNode(node);
}

function nodeGraphKnobPortalNameForNode(node) {
  const portal = String(node?.pluginName || "").trim();
  if (portal) {
    return portal;
  }
  return nodeGraphKnobResolvedDisplayNameForNode(node);
}

function nodeGraphKnobFaceLabelTextForNode(node) {
  return nodeGraphKnobResolvedDisplayNameForNode(node);
}

function nodeGraphNextFreeKnobPortalIndex(used) {
  for (let i = 0; i < 32; i += 1) {
    if (!used.has(i)) {
      return i;
    }
  }
  return null;
}

/** Unique 0–31 pluginId on every Knob. First claim wins; clashes/empty take next free. */
function nodeGraphAssignKnobPortalIndexes(patch) {
  const nodes = patch?.nodes;
  if (!Array.isArray(nodes)) {
    return false;
  }
  const used = new Set();
  let changed = false;
  for (const node of nodes) {
    if (
      !node
      || (
        node.type !== "knob"
        && node.type !== "pluginSlider"
        && node.type !== "toggleButton"
        && node.type !== "momentaryButton"
      )
    ) {
      continue;
    }
    const raw = node.pluginId;
    const has = raw === 0 || (raw != null && raw !== "");
    let id = has ? Math.round(Number(raw)) : NaN;
    if (!Number.isFinite(id) || id < 0 || id > 31 || used.has(id)) {
      id = nodeGraphNextFreeKnobPortalIndex(used);
    }
    if (id == null) {
      if (Object.hasOwn(node, "pluginId")) {
        delete node.pluginId;
        changed = true;
      }
      continue;
    }
    if (node.pluginId !== id) {
      node.pluginId = id;
      changed = true;
    }
    used.add(id);
  }
  return changed;
}

function nodeGraphKnobFaceApplyLabelTextToDom(nodeId, text) {
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const shown = nodeGraphKnobFaceNormalizeLabelText(text)
    || (typeof nodeGraphKnobResolvedDisplayNameForNode === "function"
      ? nodeGraphKnobResolvedDisplayNameForNode(patchNode)
      : "")
    || nodeGraphKnobModuleTitleForNode(patchNode)
    || String(nodeGraphNodeLabels?.[patchNode?.type] || "Knob");
  const knobFace = document.querySelector(`.node-knob-face[data-node="${CSS.escape(String(nodeId || ""))}"]`);
  const knobLabel = knobFace?.querySelector?.("[data-knob-face-label]");
  if (knobLabel && knobLabel.dataset.editing !== "true") {
    knobLabel.textContent = shown;
  }
  const btnFace = document.querySelector(
    `.node-plugin-toggle-face[data-node="${CSS.escape(String(nodeId || ""))}"], .node-plugin-momentary-face[data-node="${CSS.escape(String(nodeId || ""))}"]`,
  );
  if (knobFace) {
    renderNodeGraphKnobFace(knobFace);
  }
  btnFace?.syncFromParameters?.();
  const settingsInput = document.getElementById("nodeSceneKnobTextInput");
  if (settingsInput && document.activeElement !== settingsInput) {
    const targetId = typeof nodeGraphModuleActionTargetNodeId === "function"
      ? nodeGraphModuleActionTargetNodeId()
      : "";
    if (String(targetId) === String(nodeId || "")) {
      settingsInput.value = shown;
    }
  }
}

function nodeGraphControllerFaceSettingsForNode(node) {
  if (node?.type === "pluginSlider" && typeof nodeGraphSliderFaceDisplaySettingsForNode === "function") {
    return nodeGraphSliderFaceDisplaySettingsForNode(node);
  }
  if (
    (node?.type === "toggleButton" || node?.type === "momentaryButton")
    && typeof nodeGraphPluginButtonDisplaySettingsForNode === "function"
  ) {
    return nodeGraphPluginButtonDisplaySettingsForNode(node);
  }
  return typeof nodeGraphKnobFaceDisplaySettingsForNode === "function"
    ? nodeGraphKnobFaceDisplaySettingsForNode(node)
    : {};
}

function nodeGraphControllerFaceNormalizeSettings(node, settings) {
  if (node?.type === "pluginSlider" && typeof normalizeNodeGraphSliderFaceDisplaySettings === "function") {
    return normalizeNodeGraphSliderFaceDisplaySettings(settings);
  }
  if (
    (node?.type === "toggleButton" || node?.type === "momentaryButton")
    && typeof normalizeNodeGraphPluginButtonDisplaySettings === "function"
  ) {
    return normalizeNodeGraphPluginButtonDisplaySettings(settings, node.type);
  }
  return typeof normalizeNodeGraphKnobFaceDisplaySettings === "function"
    ? normalizeNodeGraphKnobFaceDisplaySettings(settings)
    : settings;
}

function nodeGraphKnobFaceWriteLabelText(nodeId, rawText, { record = true } = {}) {
  const id = String(nodeId || "").trim();
  if (!id) {
    return;
  }
  const stored = nodeGraphKnobFaceNormalizeLabelText(rawText);
  if (!record) {
    const live = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(id) : null;
    if (!live) {
      return;
    }
    const current = nodeGraphControllerFaceSettingsForNode(live);
    live.traceDisplaySettings = nodeGraphControllerFaceNormalizeSettings(live, { ...current, labelText: stored });
    if (nodeGraphMvp) {
      nodeGraphMvp.patchDirtyState = "edited";
    }
    nodeGraphKnobFaceApplyLabelTextToDom(id, stored);
    return;
  }
  if (typeof cloneNodeGraphPatch !== "function" || typeof commitNodeGraphPatch !== "function") {
    return;
  }
  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  const target = patch.nodes.find((node) => node.id === id);
  if (!target) {
    return;
  }
  const current = nodeGraphControllerFaceSettingsForNode(target);
  const next = nodeGraphControllerFaceNormalizeSettings(target, { ...current, labelText: stored });
  if (nodeGraphKnobFaceNormalizeLabelText(current.labelText) === next.labelText) {
    nodeGraphKnobFaceApplyLabelTextToDom(id, next.labelText);
    return;
  }
  target.traceDisplaySettings = next;
  commitNodeGraphPatch(patch, { status: "display name changed" });
}

function beginNodeGraphKnobFaceLabelEdit(label, nodeId) {
  if (!label || label.dataset.editing === "true") {
    return;
  }
  if (typeof nodeGraphPatchIsLocked === "function" && nodeGraphPatchIsLocked()) {
    return;
  }
  label.dataset.editing = "true";
  label.contentEditable = "true";
  label.spellcheck = false;
  label.focus({ preventScroll: true });
  const selection = window.getSelection?.();
  if (selection && document.createRange) {
    const range = document.createRange();
    range.selectNodeContents(label);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  const finish = (commit) => {
    if (label.dataset.editing !== "true") {
      return;
    }
    label.dataset.editing = "false";
    label.contentEditable = "false";
    const allowCommit = commit && !(typeof nodeGraphPatchIsLocked === "function" && nodeGraphPatchIsLocked());
    const next = allowCommit ? label.textContent : nodeGraphKnobFaceLabelTextForNode(
      typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null,
    );
    nodeGraphKnobFaceWriteLabelText(nodeId, next, { record: true });
  };
  const onKey = (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      label.removeEventListener("keydown", onKey);
      label.removeEventListener("blur", onBlur);
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      label.removeEventListener("keydown", onKey);
      label.removeEventListener("blur", onBlur);
      finish(false);
    }
  };
  const onBlur = () => {
    label.removeEventListener("keydown", onKey);
    label.removeEventListener("blur", onBlur);
    finish(true);
  };
  label.addEventListener("keydown", onKey);
  label.addEventListener("blur", onBlur);
}

function attachNodeGraphKnobFaceLabelEdit(label, nodeId) {
  if (!label || label.dataset.labelEditBound === "true") {
    return;
  }
  label.dataset.labelEditBound = "true";
  label.title = "Click to edit knob text (separate from module title)";
  const stopDrag = (event) => {
    event.stopPropagation();
  };
  label.addEventListener("pointerdown", stopDrag);
  label.addEventListener("mousedown", stopDrag);
  label.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    beginNodeGraphKnobFaceLabelEdit(label, nodeId);
  });
}

function nodeGraphControllerFaceReadoutSettings(patchNode) {
  const type = String(patchNode?.type || "");
  if (type === "pluginSlider" && typeof nodeGraphSliderFaceDisplaySettingsForNode === "function") {
    return nodeGraphSliderFaceDisplaySettingsForNode(patchNode);
  }
  if (typeof nodeGraphKnobFaceDisplaySettingsForNode === "function") {
    return nodeGraphKnobFaceDisplaySettingsForNode(patchNode);
  }
  return patchNode?.traceDisplaySettings && typeof patchNode.traceDisplaySettings === "object"
    ? patchNode.traceDisplaySettings
    : {};
}

/**
 * Format the face readout from the node's Bias parameter metadata.
 * The body slider and both controller faces therefore share one formatter:
 * maxDigits, kind, sign policy, trailing-zero policy, and choice labels all
 * come directly from Bias instead of Display Settings.
 */
function nodeGraphKnobFaceFormatReadout(value, patchNode, slider) {
  if (slider && typeof nodeSliderReadoutValueText === "function") {
    return nodeSliderReadoutValueText(slider);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "";
  }
  const metadata = nodeGraphKnobFaceOffsetMetadata(patchNode);
  const choiceLabel = typeof nodeGraphPatchChoiceLabel === "function"
    ? nodeGraphPatchChoiceLabel(metadata, number)
    : null;
  if (choiceLabel != null) {
    return ` ${choiceLabel}`;
  }
  if (typeof formatNodeSliderNumber === "function") {
    return formatNodeSliderNumber(number, {
      kind: metadata.kind,
      maxDigits: metadata.maxDigits,
      reserveSignSpace: true,
      showSign: metadata.showSign,
      removeTrailingZeros: metadata.removeTrailingZeros,
    });
  }
  return String(number);
}

/**
 * Latest live Bias sample from scope capture (final worklet output:
 * signal In + effective slider). This is what a DISPLAY must show — not
 * the static param meta alone.
 */
function nodeGraphKnobFaceLatestScopeSample(nodeId) {
  const id = String(nodeId || "").trim();
  if (!id || typeof nodeGraphModuleScopeState === "undefined") {
    return null;
  }
  const buffers = nodeGraphModuleScopeState?.buffers;
  if (!buffers?.get) {
    return null;
  }
  for (const key of [`${id}:Bias`, `${id}:Out`, id]) {
    const buffer = buffers.get(key);
    if (!buffer?.length) {
      continue;
    }
    const sample = Number(buffer[buffer.length - 1]);
    if (Number.isFinite(sample)) {
      return sample;
    }
  }
  return null;
}

/** Source node latest sample (signal port) for main-thread modulation preview. */
function nodeGraphKnobFaceSourceSample(sourceNode, sourcePort) {
  const id = String(sourceNode || "").trim();
  const port = String(sourcePort || "").trim();
  if (!id) {
    return null;
  }
  if (typeof nodeGraphModuleScopeState !== "undefined") {
    const buffers = nodeGraphModuleScopeState?.buffers;
    if (buffers?.get) {
      for (const key of port ? [`${id}:${port}`, id] : [id]) {
        const buffer = buffers.get(key);
        if (buffer?.length) {
          const sample = Number(buffer[buffer.length - 1]);
          if (Number.isFinite(sample)) {
            return sample;
          }
        }
      }
    }
  }
  // Parameter-port sources (other sliders / knobs).
  if (port && typeof nodeGraphParameterOutputPort === "function") {
    const type = typeof nodeGraphPatchNodeType === "function"
      ? nodeGraphPatchNodeType(id)
      : null;
    if (type && nodeGraphParameterOutputPort(type, port)) {
      if (typeof nodeGraphReadNodeNumber === "function") {
        const n = nodeGraphReadNodeNumber(id, port);
        if (Number.isFinite(n)) {
          return n;
        }
      }
      if (typeof nodeGraphReadPatchParameterValue === "function") {
        const n = nodeGraphReadPatchParameterValue(id, port);
        if (Number.isFinite(n)) {
          return n;
        }
      }
    }
  }
  return null;
}

/**
 * Final displayed Bias: scope Bias first, else In + effective slider.
 * Parameter meta (slider text) is NOT the display — this is.
 */
function nodeGraphKnobFaceLiveOffset(nodeId) {
  const id = String(nodeId || "").trim();
  const scoped = nodeGraphKnobFaceLatestScopeSample(id);
  if (scoped != null) {
    return scoped;
  }
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(id) : null;
  if (!patchNode) {
    return 0;
  }
  const metadata = typeof nodeGraphReadPatchParameterMetadata === "function"
    ? nodeGraphReadPatchParameterMetadata(patchNode, "offset")
    : {};
  let base = typeof nodeGraphReadNodeNumber === "function"
    ? nodeGraphReadNodeNumber(id, "offset")
    : Number(patchNode.params?.offset);
  if (!Number.isFinite(base)) {
    base = 0;
  }
  // Param-row unit CV (optional) on top of the manual slider.
  const modulations = Array.isArray(nodeGraphMvp?.patch?.modulations)
    ? nodeGraphMvp.patch.modulations
    : [];
  let contribution = 0;
  let hasMod = false;
  for (const modulation of modulations) {
    if (modulation.destinationNode !== id || modulation.destinationParam !== "offset") {
      continue;
    }
    const src = nodeGraphKnobFaceSourceSample(
      modulation.sourceNode,
      modulation.sourcePort,
    );
    if (src == null || !Number.isFinite(src)) {
      continue;
    }
    hasMod = true;
    // Phase F: MOD is bipolar unit [−1, 1]; sum then apply once.
    if (typeof normalizeNodeGraphParameterModulationInput === "function") {
      contribution += normalizeNodeGraphParameterModulationInput(src, metadata);
    } else if (typeof nodeGraphParamNormalizeModInput === "function") {
      contribution += nodeGraphParamNormalizeModInput(src, metadata);
    } else {
      contribution += src;
    }
  }
  let slider = base;
  if (hasMod) {
    if (typeof nodeGraphParamApplyMod === "function") {
      slider = nodeGraphParamApplyMod(base, contribution, metadata);
    } else if (typeof nodeGraphApplyParameterModulation === "function") {
      slider = nodeGraphApplyParameterModulation(base, contribution, metadata);
    } else {
      slider = base + contribution;
    }
  }
  // Dedicated signal In: domain add (same as worklet/live evaluator).
  let inputSum = 0;
  const connections = Array.isArray(nodeGraphMvp?.patch?.connections)
    ? nodeGraphMvp.patch.connections
    : [];
  for (const connection of connections) {
    if (connection.destinationNode !== id || connection.destinationPort !== "In") {
      continue;
    }
    const src = nodeGraphKnobFaceSourceSample(
      connection.sourceNode,
      connection.sourcePort,
    );
    if (src != null && Number.isFinite(src)) {
      inputSum += src;
    }
  }
  return inputSum + slider;
}

/** Bias domain from Bias parameter min/max (Parameter Settings). */
function nodeGraphKnobFaceBiasRange(patchNode) {
  if (typeof nodeGraphDspKnobOffsetDomain === "function") {
    return nodeGraphDspKnobOffsetDomain(patchNode);
  }
  let meta = null;
  if (typeof nodeGraphReadPatchParameterMetadata === "function" && patchNode) {
    meta = nodeGraphReadPatchParameterMetadata(patchNode, "offset");
  }
  if (!meta || typeof meta !== "object") {
    meta = patchNode?.paramMeta?.offset && typeof patchNode.paramMeta.offset === "object"
      ? patchNode.paramMeta.offset
      : {};
  }
  const lo = Number(meta.min);
  const hi = Number(meta.max);
  if (Number.isFinite(lo) && Number.isFinite(hi)) {
    const bipolar = meta.bipolar === true || (lo < 0 && hi > 0);
    return { bipolar, max: hi >= lo ? hi : lo, min: hi >= lo ? lo : hi };
  }
  return { bipolar: false, max: 1, min: 0 };
}

function nodeGraphKnobFaceOffsetMetadata(patchNode) {
  if (typeof nodeGraphReadPatchParameterMetadata === "function" && patchNode) {
    const meta = nodeGraphReadPatchParameterMetadata(patchNode, "offset");
    if (meta && typeof meta === "object") return meta;
  }
  const raw = patchNode?.paramMeta?.offset;
  return raw && typeof raw === "object" ? raw : {};
}

function nodeGraphKnobFaceUnitFromValue(value, patchNode) {
  const meta = nodeGraphKnobFaceOffsetMetadata(patchNode);
  if (typeof nodeGraphParamControlPosition === "function") {
    return nodeGraphParamControlPosition(value, meta);
  }
  const range = nodeGraphKnobFaceBiasRange(patchNode);
  const lo = range.min;
  const hi = range.max;
  if (!(hi > lo)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, (Number(value) - lo) / (hi - lo)));
}

/** Per-frame paint helper: attribute writes invalidate style even when equal. */
function nodeGraphSetAttrIfChanged(element, name, value) {
  if (element && element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

/** Keep Bias slider + face ARIA matched to Bias Parameter Settings min/max. */
function nodeGraphKnobFaceSyncOffsetDomain(patchNode) {
  if (!patchNode?.id) {
    return null;
  }
  const range = nodeGraphKnobFaceBiasRange(patchNode);
  const slider = typeof document !== "undefined"
    ? document.getElementById(`node-${patchNode.id}-offset`)
    : null;
  if (slider) {
    // Interactive thumb range only. Do NOT rewrite dataset.paramMin/paramMax —
    // those are Parameter Settings SSOT; stomping them from paramMeta every
    // paint raced metadata apply and snapped max back (e.g. 150 → 130).
    const min = String(range.min);
    const max = String(range.max);
    const bipolar = range.bipolar ? "true" : "false";
    if (slider.min !== min) {
      slider.min = min;
    }
    if (slider.max !== max) {
      slider.max = max;
    }
    if (slider.dataset) {
      if (slider.dataset.min !== min) {
        slider.dataset.min = min;
      }
      if (slider.dataset.max !== max) {
        slider.dataset.max = max;
      }
      if (slider.dataset.bipolar !== bipolar) {
        slider.dataset.bipolar = bipolar;
      }
    }
  }
  // Do not write Bias min/max / paramMin / paramMax here — Parameter Settings owns them.
  const face = typeof nodeGraphCachedNodeElement === "function"
    ? nodeGraphCachedNodeElement(".node-knob-face", patchNode.id)
    : (typeof document !== "undefined"
      ? document.querySelector(`.node-knob-face[data-node="${CSS.escape(String(patchNode.id))}"]`)
      : null);
  if (face) {
    nodeGraphSetAttrIfChanged(face, "aria-valuemin", String(range.min));
    nodeGraphSetAttrIfChanged(face, "aria-valuemax", String(range.max));
  }
  return range;
}

function nodeGraphKnobFaceUnitFromParams(patchNode) {
  const live = nodeGraphKnobFaceLiveOffset(patchNode?.id);
  return nodeGraphKnobFaceUnitFromValue(live, patchNode);
}

/**
 * Canvas-safe Bias type-in: overlay an input on the drawn number (or dial).
 * Does not use the module body Bias/offset readout (missing on layout canvas).
 * Writes through the hidden offset slider → same DSP path as the Bias slider.
 */
function beginNodeGraphKnobFaceValueEdit(face, event = null) {
  if (!face || face.dataset.knobFaceEditing === "true") {
    return false;
  }
  if (typeof nodeGraphPatchIsLocked === "function" && nodeGraphPatchIsLocked()) {
    return false;
  }
  const nodeId = String(face.dataset.node || "").trim();
  if (!nodeId) {
    return false;
  }
  const slider = document.getElementById(`node-${nodeId}-offset`);
  if (!slider) {
    return false;
  }
  if (event) {
    event.preventDefault?.();
    event.stopPropagation?.();
  }

  face.dataset.knobFaceEditing = "true";
  paintNodeGraphKnobFaceLive(face, nodeId, null);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "node-knob-face-value-input";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.spellcheck = false;
  const domainRaw = Number(slider.dataset?.domainValue);
  const editValue = Number.isFinite(domainRaw) ? domainRaw : Number(slider.value);
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  input.value = typeof nodeGraphKnobFaceFormatReadout === "function"
    ? nodeGraphKnobFaceFormatReadout(editValue, patchNode, slider)
    : String(editValue);
  input.setAttribute("aria-label", `${nodeGraphNodeDisplayName?.(nodeId) || "Knob"} Bias`);
  input.dataset.node = nodeId;
  input.dataset.sliderTarget = slider.id;

  const stop = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  };
  for (const name of ["pointerdown", "mousedown", "click", "dblclick", "pointerup", "mouseup"]) {
    input.addEventListener(name, stop);
  }

  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    face.dataset.knobFaceEditing = "false";
    document.removeEventListener("pointerdown", closeOutside, true);
    const allowCommit = commit && !(typeof nodeGraphPatchIsLocked === "function" && nodeGraphPatchIsLocked());
    if (allowCommit) {
      if (typeof updateNodeSliderCurrentValue === "function") {
        updateNodeSliderCurrentValue(slider, input.value);
      }
    }
    input.remove();
    paintNodeGraphKnobFaceLive(face, nodeId, null);
  };

  const closeOutside = (ev) => {
    if (!document.contains(input) || finished) {
      document.removeEventListener("pointerdown", closeOutside, true);
      return;
    }
    if (ev.target === input || input.contains?.(ev.target)) {
      return;
    }
    finish(true);
  };

  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      finish(true);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    }
  });
  input.addEventListener("blur", () => {
    if (!finished) finish(true);
  });

  // Overlay on the drawn number (or the dial when the number is off).
  const wrap = face;
  const box = face._ctrlLayout?.rects?.value || face._ctrlLayout?.rects?.dial || null;
  input.style.position = "absolute";
  input.style.zIndex = "20";
  input.style.transform = "translate(-50%, -50%)";
  if (box && face._ctrlLayout) {
    const L = face._ctrlLayout;
    input.style.left = `${(((box.x + box.w * 0.5) / L.w) * 100).toFixed(4)}%`;
    input.style.top = `${(((box.y + box.h * 0.5) / L.h) * 100).toFixed(4)}%`;
  } else {
    input.style.left = "50%";
    input.style.top = "50%";
  }
  wrap.append(input);
  document.addEventListener("pointerdown", closeOutside, true);
  input.focus();
  input.select();
  return true;
}

/**
 * Face is a full drag surface for Bias (offset), same path/modifiers as
 * `.node-slider-readout` (beginNodeSliderDrag / nodeSliderFineTuneScale / etc.).
 */
function attachNodeGraphKnobFaceDrag(face) {
  if (!face || face.dataset.sliderDragBound === "true") {
    return;
  }
  face.dataset.sliderDragBound = "true";
  if (typeof beginNodeSliderDrag === "function") {
    face.addEventListener("pointerdown", beginNodeSliderDrag);
    face.addEventListener("mousedown", beginNodeSliderDrag);
  }
  if (typeof endNodeSliderDrag === "function") {
    face.addEventListener("lostpointercapture", endNodeSliderDrag);
  }
  if (typeof stepNodeSliderFromKeyboard === "function") {
    face.addEventListener("keydown", stepNodeSliderFromKeyboard);
  }
  face.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.altKey) {
      return;
    }
    if (typeof beginNodeGraphKnobFaceValueEdit === "function") {
      beginNodeGraphKnobFaceValueEdit(face, event);
    }
  });
}

/** Knob/Slider/Toggle/Momentary faces are lit screens (room dimmer cutout). */
function nodeGraphKnobFaceSyncLightSource(face, _lit = true) {
  if (!face) {
    return false;
  }
  face.classList.add("node-light-source");
  if (face.dataset) {
    face.dataset.lightSource = "screen";
    face.dataset.lightStrength = "1";
  }
  if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
    nodeGraphModuleScopeMarkScreenLit(face, 1);
  } else if (typeof setNodeGraphLightStrength === "function") {
    setNodeGraphLightStrength(face, 1);
  }
  return true;
}

/** Bias value the face shows: mouse target (Display = Mouse) or live Bias. */
function nodeGraphKnobFaceShownValue(nodeId, patchNode, buffer = null) {
  const wantsMouse = typeof nodeGraphDspControllerDisplayIsMouse === "function"
    ? nodeGraphDspControllerDisplayIsMouse(patchNode)
    : true;
  let value = null;
  if (wantsMouse) {
    const slider = document.getElementById(`node-${nodeId}-offset`);
    const domain = Number(slider?.dataset?.domainValue);
    if (Number.isFinite(domain)) {
      value = domain;
    } else {
      const base = typeof nodeGraphReadNodeNumber === "function"
        ? nodeGraphReadNodeNumber(nodeId, "offset")
        : Number(patchNode?.params?.offset);
      value = Number.isFinite(base) ? base : 0;
    }
  } else {
    value = nodeGraphKnobFaceLiveOffset(nodeId);
    if (!Number.isFinite(value) && buffer?.length) {
      const sample = Number(buffer[buffer.length - 1]);
      if (Number.isFinite(sample)) {
        value = sample;
      }
    }
  }
  return Number.isFinite(value) ? value : 0;
}

/**
 * Unit positions for a controller face: value, zero (fill origin: the low end,
 * or 0 for a bipolar Bias range) and the modulation ghost (the target the
 * engine is sent), clamped to the Bias range per the ghost-slider policy.
 */
function nodeGraphKnobFaceUnits(nodeId, patchNode, value) {
  const node = patchNode || { id: nodeId };
  const unit = Math.max(0, Math.min(1, nodeGraphKnobFaceUnitFromValue(value, node)));
  const range = nodeGraphKnobFaceBiasRange(patchNode);
  const zero = range.bipolar
    ? Math.max(0, Math.min(1, nodeGraphKnobFaceUnitFromValue(0, node)))
    : 0;
  const slider = document.getElementById(`node-${nodeId}-offset`);
  const sent = Number(slider?.dataset?.sentDomainValue);
  let ghost = null;
  if (Number.isFinite(sent) && Math.abs(sent - value) > 1e-9) {
    ghost = Math.max(0, Math.min(1, nodeGraphKnobFaceUnitFromValue(sent, node)));
    if (Math.abs(ghost - unit) < 1e-4) ghost = null;
  }
  const numberValue = Number.isFinite(sent) ? sent : value;
  return { unit, zero, ghost, numberValue, slider };
}

/** Paint the Knob face from live Bias. Call every display frame / on drag. */
function paintNodeGraphKnobFaceLive(face, nodeId, buffer = null) {
  if (face?.classList?.contains("is-slider-look") && typeof paintNodeGraphSliderFaceLive === "function") {
    paintNodeGraphSliderFaceLive(face, nodeId, buffer);
    return;
  }
  if (!face || !nodeId) {
    return;
  }
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (patchNode) {
    nodeGraphKnobFaceSyncOffsetDomain(patchNode);
  }
  const s = nodeGraphKnobFaceDisplaySettingsForNode(patchNode);
  const value = nodeGraphKnobFaceShownValue(nodeId, patchNode, buffer);
  const u = nodeGraphKnobFaceUnits(nodeId, patchNode, value);
  const liveValue = String(value);
  if (face.dataset.liveValue !== liveValue) {
    face.dataset.liveValue = liveValue;
  }
  if (face.getAttribute("aria-valuenow") !== liveValue) {
    face.setAttribute("aria-valuenow", liveValue);
  }
  const label = typeof nodeGraphCachedChild === "function"
    ? nodeGraphCachedChild(face, "[data-knob-face-label]")
    : face.querySelector("[data-knob-face-label]");
  const labelText = s.labelPosition === "off" ? "" : nodeGraphKnobFaceLabelTextForNode(patchNode);
  if (label && label.dataset.editing !== "true" && label.textContent !== labelText) {
    label.textContent = labelText;
  }
  const model = {
    settings: { labelPosition: s.labelPosition, valuePosition: s.valuePosition, innerRadius: s.innerRadius },
    background: s.background,
    fill: s.arcFill,
    track: s.arcTrack,
    text: s.textColor,
    span: s.rotationDegrees,
    unit: u.unit,
    zero: u.zero,
    ghost: u.ghost,
    value: s.valuePosition,
    labelText,
    labelEditing: label?.dataset?.editing === "true",
    valueText: s.valuePosition === "off" ? "" : nodeGraphKnobFaceFormatReadout(u.numberValue, patchNode, u.slider),
    valueEditing: face.dataset.knobFaceEditing === "true",
  };
  const hit = typeof nodeGraphCachedChild === "function"
    ? nodeGraphCachedChild(face, "[data-knob-face-dial]")
    : face.querySelector("[data-knob-face-dial]");
  face._ctrlLayout = nodeGraphControllerFacePaint(face, "knob", model, (L) => {
    nodeGraphControllerFacePlace(hit, L.rects.dial, L.w, L.h);
    nodeGraphControllerFacePlace(label, labelText ? L.rects.label : null, L.w, L.h);
  }) || face._ctrlLayout;
  nodeGraphKnobFaceSyncLightSource(face, true);
}

/** Build the LayoutB face DOM (called from factories). */
function createNodeGraphKnobFace(node, type) {
  const face = document.createElement("div");
  face.className = "node-knob-face node-module-scope-window node-controller-gl-face";
  face.dataset.node = node;
  face.dataset.nodeType = type || "knob";
  face.dataset.controllerFace = "knob";
  face.dataset.sliderTarget = `node-${node}-offset`;
  face.dataset.lightStrength = "1";
  face.dataset.lightSource = "screen";
  face.tabIndex = 0;
  face.setAttribute("role", "slider");
  face.setAttribute("aria-label", `${nodeGraphNodeDisplayName(node)} knob`);
  face.setAttribute("aria-valuemin", "-1");
  face.setAttribute("aria-valuemax", "1");
  face.setAttribute("aria-valuenow", "0");

  // Transparent hit circle over the drawn dial (drag travel / circular hit).
  const dial = document.createElement("span");
  dial.className = "node-controller-face-hit";
  dial.dataset.knobFaceDial = "true";
  dial.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.className = "node-knob-face-label node-controller-face-label";
  label.dataset.knobFaceLabel = "true";
  attachNodeGraphKnobFaceLabelEdit(label, node);

  face.append(dial, label);
  nodeGraphControllerFaceCanvas(face);
  attachNodeGraphKnobFaceDrag(face);
  nodeGraphControllerFaceObserve(face, () => paintNodeGraphKnobFaceLive(face, face.dataset.node, null));
  requestAnimationFrame(() => paintNodeGraphKnobFaceLive(face, node, null));
  return face;
}

function renderNodeGraphKnobFace(faceOrNodeId, nodeIdOpt) {
  const face = faceOrNodeId instanceof Element
    ? faceOrNodeId
    : document.querySelector(`.node-knob-face[data-node="${CSS.escape(String(faceOrNodeId || ""))}"]`);
  const nodeId = String(nodeIdOpt || face?.dataset?.node || faceOrNodeId || "").trim();
  if (!face || !nodeId) {
    return;
  }
  paintNodeGraphKnobFaceLive(face, nodeId, null);
}

function refreshNodeGraphKnobFaces() {
  for (const face of document.querySelectorAll(".node-knob-face")) {
    const id = face.dataset?.node;
    if (!id) continue;
    if (face.classList.contains("is-slider-look")) {
      if (typeof paintNodeGraphSliderFaceLive === "function") {
        paintNodeGraphSliderFaceLive(face, id, null);
      }
      continue;
    }
    paintNodeGraphKnobFaceLive(face, id, null);
  }
}

/** Live Bias drag: repaint the Knob / Slider face for this offset slider. */
function syncNodeGraphKnobFaceFromSlider(slider) {
  if (!slider || slider.dataset.param !== "offset") {
    return;
  }
  const module = slider.closest?.(".dsp-node");
  const type = module?.dataset?.nodeType;
  if (!module || (type !== "knob" && type !== "pluginSlider")) {
    return;
  }
  const nodeId = module.dataset.node;
  let face = module.querySelector(".node-knob-face");
  if (!face && nodeId) {
    face = document.querySelector(`.node-knob-face[data-node="${CSS.escape(String(nodeId))}"]`);
  }
  if (!face || !nodeId) {
    return;
  }
  if (type === "pluginSlider" || face.classList.contains("is-slider-look")) {
    if (typeof paintNodeGraphSliderFaceLive === "function") {
      paintNodeGraphSliderFaceLive(face, nodeId, null);
    }
    return;
  }
  paintNodeGraphKnobFaceLive(face, nodeId, null);
}

function nodeGraphKnobFaceTargetNodeId(explicitId = "") {
  const fromArg = String(explicitId || "").trim();
  if (fromArg) {
    return fromArg;
  }
  // Prefer the Display Settings target.
  if (typeof nodeGraphTraceDisplaySettingsTargetNodeId === "function") {
    const fromDisplay = String(nodeGraphTraceDisplaySettingsTargetNodeId() || "").trim();
    if (fromDisplay) {
      return fromDisplay;
    }
  }
  if (nodeGraphMvp?.traceDisplaySettingsTargetNode) {
    return String(nodeGraphMvp.traceDisplaySettingsTargetNode).trim();
  }
  return String(
    (typeof nodeGraphModuleActionTargetNodeId === "function"
      ? nodeGraphModuleActionTargetNodeId()
      : "") || "",
  ).trim();
}

function nodeGraphKnobFacePatchTarget(nodeId) {
  const id = nodeGraphKnobFaceTargetNodeId(nodeId);
  const patch = typeof cloneNodeGraphPatch === "function"
    ? cloneNodeGraphPatch(nodeGraphMvp.patch)
    : null;
  const targetNode = patch?.nodes?.find((node) => node.id === id) || null;
  return { id, patch, targetNode };
}

function commitNodeGraphKnobPluginIdentity() {
  const moduleId = typeof nodeGraphModuleActionTargetNodeId === "function"
    ? nodeGraphModuleActionTargetNodeId()
    : "";
  const { patch, targetNode } = nodeGraphKnobFacePatchTarget(moduleId);
  if (
    !patch
    || !targetNode
    || (
      targetNode.type !== "knob"
      && targetNode.type !== "pluginSlider"
      && targetNode.type !== "toggleButton"
      && targetNode.type !== "momentaryButton"
    )
  ) {
    return;
  }
  const folderEl = document.getElementById("nodeSceneKnobPluginFolder");
  const nameEl = document.getElementById("nodeSceneKnobPluginName");
  const idEl = document.getElementById("nodeSceneKnobPluginId");
  if (!folderEl && !nameEl && !idEl) {
    return;
  }
  const folder = String(folderEl?.value || "").trim();
  const name = String(nameEl?.value || "").trim();
  const idRaw = String(idEl?.value || "").trim();
  if (folder) {
    targetNode.pluginFolder = folder;
  } else {
    delete targetNode.pluginFolder;
  }
  if (name) {
    targetNode.pluginName = name;
  } else {
    delete targetNode.pluginName;
  }
  if (idRaw === "") {
    delete targetNode.pluginId;
  } else {
    let n = Math.round(Number(idRaw));
    if (!Number.isFinite(n)) {
      delete targetNode.pluginId;
    } else {
      n = Math.max(0, Math.min(31, n));
      targetNode.pluginId = n;
      if (idEl && String(idEl.value) !== String(n) && document.activeElement !== idEl) {
        idEl.value = String(n);
      }
    }
  }
  if (typeof commitNodeGraphPatch === "function") {
    commitNodeGraphPatch(patch, { record: true, status: "plugin identity", softDom: true, markPending: false });
  }
}

/**
 * Right-click on a Knob / Slider face → Display Settings.
 */
function openNodeKnobFaceContextMenu(event) {
  const target = event?.target;
  if (!(target instanceof Element)) {
    return false;
  }
  const face = target.closest?.(".node-knob-face");
  if (!face) {
    return false;
  }
  const nodeEl = face.closest?.(".dsp-node");
  const nodeId = String(nodeEl?.dataset?.node || face.dataset?.node || "").trim();
  const patchNode = nodeId && typeof nodeGraphPatchNode === "function"
    ? nodeGraphPatchNode(nodeId)
    : null;
  if (!patchNode || (patchNode.type !== "knob" && patchNode.type !== "pluginSlider")) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  if (typeof ensureNodeGraphModuleSelectedForContext === "function") {
    ensureNodeGraphModuleSelectedForContext(nodeId, event);
  }
  if (nodeGraphMvp) {
    nodeGraphMvp.sceneContextTargetNode = nodeId;
    nodeGraphMvp.lastModuleActionTargetNode = nodeId;
  }
  if (typeof openNodeGraphTraceDisplaySettings === "function") {
    return openNodeGraphTraceDisplaySettings(nodeId, event);
  }
  return false;
}
