// Slider module face: native WebGL bar (modules/_shared/controller-face-gl.js).
// Same Bias contract as Knob (offset + In). A rounded bar fills from the low
// end (or from 0 for a bipolar Bias range); the number sits in the bar, the
// label top-left, the unit top-right, and the modulation ghost is a tick in
// the bar clamped to the Bias range. Input stays in DOM: the face is the drag
// surface, the transparent bar hit element sets the drag travel, the label is
// a transparent click-to-edit span over the drawn label.

function nodeGraphSliderFaceDisplaySettingsForNode(node) {
  const raw = node?.traceDisplaySettings && typeof node.traceDisplaySettings === "object"
    ? node.traceDisplaySettings
    : {};
  return normalizeNodeGraphSliderFaceDisplaySettings(raw);
}

function paintNodeGraphSliderFaceLive(face, nodeId, buffer = null) {
  if (!face || !nodeId) return;
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (patchNode && typeof nodeGraphKnobFaceSyncOffsetDomain === "function") {
    nodeGraphKnobFaceSyncOffsetDomain(patchNode);
  }
  const s = nodeGraphSliderFaceDisplaySettingsForNode(patchNode);
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
  const labelText = s.sliderShowLabel ? nodeGraphKnobFaceLabelTextForNode(patchNode) : "";
  if (label && label.dataset.editing !== "true" && label.textContent !== labelText) {
    label.textContent = labelText;
  }
  const unitText = s.sliderShowUnit
    ? String(u.slider?.dataset?.unit || patchNode?.paramMeta?.offset?.unit || "").trim()
    : "";
  const model = {
    settings: { sliderShowLabel: s.sliderShowLabel, sliderShowUnit: s.sliderShowUnit, sliderRounding: s.sliderRounding },
    background: s.background,
    track: s.arcTrack,
    fill: s.sliderColor,
    text: s.sliderTextColor,
    numberColor: s.sliderNumberColor,
    unit: u.unit,
    zero: u.zero,
    ghost: u.ghost,
    labelText,
    labelEditing: label?.dataset?.editing === "true",
    unitText,
    valueText: s.sliderShowNumber ? nodeGraphKnobFaceFormatReadout(u.numberValue, patchNode, u.slider) : "",
    valueEditing: face.dataset.knobFaceEditing === "true",
  };
  const hit = typeof nodeGraphCachedChild === "function"
    ? nodeGraphCachedChild(face, "[data-knob-face-dial]")
    : face.querySelector("[data-knob-face-dial]");
  face._ctrlLayout = nodeGraphControllerFacePaint(face, "slider", model, (L) => {
    nodeGraphControllerFacePlace(hit, L.rects.bar, L.w, L.h);
    nodeGraphControllerFacePlace(label, labelText ? L.rects.label : null, L.w, L.h);
  }) || face._ctrlLayout;
  if (typeof nodeGraphKnobFaceSyncLightSource === "function") {
    nodeGraphKnobFaceSyncLightSource(face, true);
  }
}

function createNodeGraphPluginSliderFace(node, type) {
  const face = document.createElement("div");
  face.className = "node-knob-face node-module-scope-window node-controller-gl-face is-slider-look";
  face.dataset.node = node;
  face.dataset.nodeType = type || "pluginSlider";
  face.dataset.controllerFace = "slider";
  face.dataset.knobLook = "slider";
  face.dataset.sliderTarget = `node-${node}-offset`;
  face.dataset.lightStrength = "1";
  face.dataset.lightSource = "screen";
  face.tabIndex = 0;
  face.setAttribute("role", "slider");
  face.setAttribute("aria-label", `${nodeGraphNodeDisplayName(node)} slider`);

  // Transparent hit rect over the drawn bar (drag travel = bar width).
  const bar = document.createElement("span");
  bar.className = "node-controller-face-hit";
  bar.dataset.knobFaceDial = "true";
  bar.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.className = "node-knob-face-label node-controller-face-label";
  label.dataset.knobFaceLabel = "true";
  if (typeof attachNodeGraphKnobFaceLabelEdit === "function") {
    attachNodeGraphKnobFaceLabelEdit(label, node);
  }

  face.append(bar, label);
  nodeGraphControllerFaceCanvas(face);
  if (typeof attachNodeGraphKnobFaceDrag === "function") {
    attachNodeGraphKnobFaceDrag(face);
  }
  nodeGraphControllerFaceObserve(face, () => paintNodeGraphSliderFaceLive(face, face.dataset.node, null));
  requestAnimationFrame(() => paintNodeGraphSliderFaceLive(face, node, null));
  return face;
}

function buildNodeGraphSliderFaceDisplaySettingsHtml() {
  const colorRow = (key) => nodeGraphDisplaySettingsBuildColorRowHtml(key, "pluginSliderFace");
  const fieldRow = (key) => nodeGraphDisplaySettingsBuildStepperRowHtml(key, "pluginSliderFace");
  const toggleRow = (key) => nodeGraphDisplaySettingsBuildToggleRowHtml(key);
  return `
    <div class="metadata-section-title">Text</div>
    <div class="metadata-field-section">${["sliderShowLabel", "sliderShowNumber", "sliderShowUnit"].map(toggleRow).join("")}${fieldRow("maxDigits")}</div>
    <div class="metadata-section-title">Bar</div>
    <div class="metadata-field-section">${fieldRow("sliderRounding")}</div>
    <div class="metadata-section-title">Colors</div>
    <div class="metadata-field-section">${(typeof nodeGraphDisplaySettingsColorRows === "function"
      ? nodeGraphDisplaySettingsColorRows(
        ["backgroundColor", "sliderColor", "arcTrack", "sliderTextColor", "sliderNumberColor"].map(colorRow),
        [3, 2],
      )
      : ["backgroundColor", "sliderColor", "arcTrack", "sliderTextColor", "sliderNumberColor"].map(colorRow).join(""))}</div>`;
}
