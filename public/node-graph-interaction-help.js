function nodeInteractionHelpText(target) {
  if (!(target instanceof Element)) {
    return "";
  }
  const helpTarget = target.closest(
    "[data-interaction-help], [data-tooltip-key], [data-native-title-disabled], button, input, textarea, select, .node-slider-readout, .node-knob-face, .node-plugin-slider-face, .node-transport-bpm-face, .node-port, .node-io-row, .node-param-port, .node-wire-hit-path, .node-wire-path, .node-execution-order-badge, .node-execution-order li[data-node], .dsp-node, #nodeGraphZoomSurface, #nodeGraphWorldLayer, #nodeGraphWorkspace",
  );
  if (!helpTarget) {
    return "";
  }
  return nodeInteractionMouseHint(helpTarget);
}

function nodeGraphInteractionHelpEventTarget(event) {
  const native = event?.target;
  if (!(native instanceof Element)) {
    return native;
  }
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace || !workspace.classList.contains("gl-graph-on") || !workspace.contains(native)) {
    return native;
  }
  if (typeof nodeGraphGlHitIsLiveHtml === "function" && nodeGraphGlHitIsLiveHtml(native)) {
    return native;
  }
  if (typeof nodeGraphGlHitKeepsNativeTarget === "function" && nodeGraphGlHitKeepsNativeTarget(native)) {
    return native;
  }
  if (typeof nodeGraphGlHitHoverElement === "function") {
    const hit = nodeGraphGlHitHoverElement(event);
    if (hit) {
      return hit;
    }
  }
  return native;
}

function nodeGraphSelectionHelpText() {
  return "";
}

function composeNodeInteractionHelpText(text = "") {
  const selectionText = nodeGraphSelectionHelpText();
  if (!selectionText) {
    return text;
  }
  return text ? `${text}\n${selectionText}` : selectionText;
}

function normalizeNodeInteractionButtonLabel(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function nodeInteractionButtonLabel(button) {
  if (!button) {
    return "";
  }
  return normalizeNodeInteractionButtonLabel(
    button.getAttribute("aria-label") ||
      button.getAttribute("title") ||
      button.title ||
      button.textContent ||
      "",
  );
}

function nodeGraphControlAuthoredTooltip(element) {
  if (!element) {
    return "";
  }
  const own = String(element.dataset?.tooltip || "").trim();
  if (own) {
    return own;
  }
  const sliderId = element.dataset?.sliderTarget;
  if (!sliderId) {
    return "";
  }
  const slider = document.getElementById(sliderId);
  return String(slider?.dataset?.tooltip || "").trim();
}

function nodeGraphControlGestureHelp(element, slider) {
  if (element.classList.contains("node-knob-face") && !element.classList.contains("is-slider-look")) {
    return nodeGraphTooltipText("slider.knob");
  }
  if (slider && typeof nodeSliderShouldDisplayChoices === "function"
    && nodeSliderShouldDisplayChoices(slider)
    && typeof nodeSliderShouldDivideChoicesVisibly === "function"
    && nodeSliderShouldDivideChoicesVisibly(slider)) {
    return nodeGraphTooltipText("slider.choices");
  }
  return nodeGraphTooltipText("slider.numeric");
}

function nodeInteractionMouseHint(element) {
  if (element.dataset.interactionHelp) {
    return element.dataset.interactionHelp;
  }
  const tooltipText = nodeGraphElementTooltipText(element);
  if (tooltipText) {
    return tooltipText;
  }
  const alias = element.dataset.alias || "";
  if (element.id === "nodeGraphWorkspace" || element.id === "nodeGraphZoomSurface" || element.id === "nodeGraphWorldLayer") {
    return nodeGraphTooltipText("workspace.pan");
  }
  if (element.classList.contains("node-drag-handle")) {
    return nodeGraphTooltipText("module.drag");
  }
  if (element.classList.contains("dsp-node")) {
    return nodeGraphTooltipText("module.drag");
  }
  if (element.classList.contains("node-action-button")) {
    return nodeGraphTooltipText("module.actions");
  }
  if (element.classList.contains("node-display-settings-button")) {
    return nodeGraphTooltipText("module.displaySettings");
  }
  if (element.classList.contains("node-metaparameter-button")) {
    return nodeGraphTooltipText("module.metaparameters");
  }
  if (element.classList.contains("node-bypass-button")) {
    return nodeGraphTooltipText("module.bypass");
  }
  if (element.classList.contains("node-execution-order-badge")) {
    const state = element.dataset.executionState || "inactive";
    if (state === "active") {
      return nodeGraphTooltipText("module.executionActive", { order: element.textContent });
    }
    if (state === "bypassed") {
      return nodeGraphTooltipText("module.executionBypassed");
    }
    return nodeGraphTooltipText("module.executionInactive");
  }
  if (element.matches(".node-execution-order li[data-node]")) {
    const order = element.dataset.executionOrder || "?";
    const nodeName = nodeGraphNodeDisplayName(element.dataset.node);
    return nodeGraphTooltipText("module.executionListItem", { order, nodeName });
  }
  if (
    element.classList.contains("node-slider-readout")
    || element.classList.contains("node-knob-face")
    || element.classList.contains("node-plugin-slider-face")
    || element.classList.contains("node-transport-bpm-face")
  ) {
    const slider = document.getElementById(element.dataset.sliderTarget);
    const authored = nodeGraphControlAuthoredTooltip(element);
    const gesture = nodeGraphControlGestureHelp(element, slider);
    if (authored && gesture) {
      return `${authored} | ${gesture}`;
    }
    return authored || gesture;
  }
  if (element.classList.contains("node-port")) {
    const action = element.classList.contains("parameter-output")
      ? nodeGraphTooltipText("wire.parameterOutput")
      : element.classList.contains("output")
      ? nodeGraphTooltipText("wire.output")
      : nodeGraphTooltipText("wire.input");
    return alias ? `${alias} | ${action}` : action;
  }
  if (element.classList.contains("node-io-row")) {
    const action = element.dataset.io === "output"
      ? nodeGraphTooltipText("wire.output")
      : nodeGraphTooltipText("wire.input");
    return alias ? `${alias} | ${action}` : action;
  }
  if (element.classList.contains("node-param-port")) {
    const action = nodeGraphTooltipText("wire.modulationInput");
    return alias ? `${alias} | ${action}` : action;
  }
  if (element.classList.contains("node-wire-hit-path") || element.classList.contains("node-wire-path")) {
    const action = nodeGraphTooltipText("wire.selected");
    return alias ? `${alias} | ${action}` : action;
  }
  if (element.classList.contains("node-text-box-input")) {
    return nodeGraphTooltipText("module.textBoxEdit");
  }
  if (element.matches("input, textarea, select")) {
    return nodeGraphTooltipText("common.editText");
  }
  if (element.id === "nodeGraphResizeHandle") {
    return nodeGraphTooltipText("workspace.resize");
  }
  if (element.id === "nodeZoomOutButton" || element.id === "nodeZoomResetButton" || element.id === "nodeZoomInButton") {
    return nodeGraphTooltipText("view.zoomHelp");
  }
  if (element.id === "nodeSnapGridViewButton") {
    return nodeGraphTooltipText("view.snapGrid");
  }
  if (element.id === "nodeSettingsViewButton") {
    return nodeGraphTooltipText("view.patchSettings") || "Script page";
  }
  if (element.id === "nodeModularInfiniteViewButton") {
    return nodeGraphTooltipText("view.infiniteModular")
      || "Computer view — infinite canvas, no crop.";
  }
  if (element.id === "nodeModularWindowedViewButton"
    || element.id === "nodeSceneToggleModularWindowedView") {
    return "Performance view — shows displays with “Show in performance view” enabled (same as F).";
  }
  if (element.id === "nodeUndoButton" || element.id === "nodeRedoButton") {
    return nodeGraphTooltipText("history.help");
  }
  if (element.id === "nodeUserUiSettingsButton") {
    return nodeGraphTooltipText("settings.uiSettingsOpen");
  }
  if (element.id === "nodeGridToggleButton") {
    return nodeGraphTooltipText("view.gridHelp");
  }
  if (element.id === "nodeTooltipToggleButton") {
    return nodeGraphTooltipsShown()
      ? (nodeGraphTooltipText("view.tipsCycleOff") || "Hide docked tips (T).")
      : (nodeGraphTooltipText("view.tipsCycleEmbed") || "Show docked tips (T).");
  }
  if (element.id === "nodeAppChromeBarsToggleButton") {
    const mode = typeof nodeGraphAppChromeBarsMode === "function"
      ? nodeGraphAppChromeBarsMode()
      : (nodeGraphMvp.appChromeBarsVisible === false ? "none" : "all");
    if (mode === "all") {
      return nodeGraphTooltipText("view.appBarsHide") || "Hide top bar (V). Press again to hide the bottom bar too.";
    }
    if (mode === "topHidden") {
      return "Hide bottom bar too (V).";
    }
    return nodeGraphTooltipText("view.appBarsShow") || "Show top and bottom bars (V).";
  }
  if (element.id === "nodeSliderAmountToggleButton") {
    return nodeGraphTooltipText(nodeGraphMvp.sliderAmountVisible ? "view.sliderAmountHide" : "view.sliderAmountShow");
  }
  if (element.id === "nodeSliderPositionToggleButton") {
    return nodeGraphTooltipText(nodeGraphMvp.sliderPositionVisible ? "view.sliderPositionHide" : "view.sliderPositionShow");
  }
  if (element.dataset.paletteNode) {
    return nodeGraphTooltipText("actions.addModule");
  }
  if (element.id === "nodeRenderButton") {
    return nodeGraphTooltipText("audio.render");
  }
  if (element.id === "nodeDeleteButton" || element.id === "nodeSceneHistoryDeleteButton") {
    return nodeGraphTooltipText("actions.deleteSelection");
  }
  if (element.matches("button")) {
    return nodeInteractionButtonLabel(element) || nodeGraphTooltipText("common.activate");
  }
  return nodeGraphTooltipText("common.interact");
}

// One font size for every tip. The box stays fixed so the page does not reflow,
// and the text wraps inside it. --node-tooltip-text-size is that size.
// Longer tips clip. fitNodeInteractionHelpText only clears an inline size left
// by an older session so the stylesheet value shows.
function fitNodeInteractionHelpText(help = document.getElementById("nodeInteractionHelp")) {
  if (!help) {
    return;
  }
  help.style.removeProperty("font-size");
  help.style.removeProperty("align-items");
}

function setNodeInteractionHelp(text = "") {
  const help = document.getElementById("nodeInteractionHelp");
  if (help) {
    const composedText = composeNodeInteractionHelpText(text);
    if (help.textContent === composedText) {
      return;
    }
    help.textContent = composedText;
    fitNodeInteractionHelpText(help);
  }
}

function handleNodeInteractionHelp(event) {
  setNodeInteractionHelp(nodeInteractionHelpText(nodeGraphInteractionHelpEventTarget(event)));
}

function attachNodeInteractionHelpTarget(element) {
  element.dataset.interactionHelpReady = "true";
  const showHelp = () => setNodeInteractionHelp(nodeInteractionHelpText(element));
  element.addEventListener("pointerover", showHelp);
  element.addEventListener("mouseover", showHelp);
  element.addEventListener("pointerdown", showHelp);
  element.addEventListener("click", showHelp);
  element.addEventListener("focus", showHelp);
}
