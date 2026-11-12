function populateNodeSliderReadoutShell(readout) {
  const amountFill = document.createElement("span");
  amountFill.className = "node-slider-amount-fill";
  amountFill.setAttribute("aria-hidden", "true");
  const portalLeft = document.createElement("span");
  portalLeft.className = "node-slider-readout-portal node-slider-readout-portal-left";
  portalLeft.setAttribute("aria-hidden", "true");
  const portalRight = document.createElement("span");
  portalRight.className = "node-slider-readout-portal node-slider-readout-portal-right";
  portalRight.setAttribute("aria-hidden", "true");
  const labelText = document.createElement("span");
  labelText.className = "node-slider-readout-label";
  const valueText = document.createElement("span");
  valueText.className = "node-slider-readout-value";
  const unitText = document.createElement("span");
  unitText.className = "node-slider-readout-unit";
  readout.append(amountFill, portalLeft, portalRight, labelText, valueText, unitText);
}

function nodeSliderResolveLiveReadout(readout) {
  if (readout?.isConnected) {
    return readout;
  }
  const id = String(readout?.dataset?.sliderTarget || "").trim();
  if (!id) {
    return null;
  }
  return document.querySelector(`.node-slider-readout[data-slider-target="${CSS.escape(id)}"]`);
}

function nodeSliderReadoutEditRefreshChrome() {
  if (typeof nodeGraphGlGraphRebuildChrome === "function") {
    nodeGraphGlGraphRebuildChrome();
  }
  if (typeof nodeGraphGlGraphPresentSoon === "function") {
    nodeGraphGlGraphPresentSoon();
  }
}

// Edit text starts in the shown unit (percent, ms) when the slider has a
// displayInverse to map typed text back (updateNodeSliderCurrentValue).
function nodeSliderEditShownValue(slider, value) {
  const plain = { value, kind: slider.dataset.kind, maxDigits: slider.dataset.maxDigits };
  if (typeof slider.displayTransform !== "function" || typeof slider.displayInverse !== "function") return plain;
  let shown = null;
  try {
    shown = slider.displayTransform(value, slider);
  } catch (error) {
    return plain;
  }
  const shownValue = Number(shown && typeof shown === "object" ? shown.value : shown);
  if (!Number.isFinite(shownValue)) return plain;
  return { value: shownValue, kind: "", maxDigits: shown?.maxDigits ?? slider.dataset.maxDigits };
}

function commitNodeSliderReadoutEdit(input) {
  if (input.dataset.editCanceled === "true" || input.dataset.editCommitted === "true") {
    return;
  }
  if (typeof nodeGraphPatchIsLocked === "function" && nodeGraphPatchIsLocked()) {
    cancelNodeSliderReadoutEdit(input);
    return;
  }
  input.dataset.editCommitted = "true";
  const slider = document.getElementById(input.dataset.sliderTarget);
  updateNodeSliderCurrentValue(slider, input.value);
  if (input.dataset.faceOverlay === "true") {
    const surface = input.parentElement;
    input.remove();
    if (surface) surface.dataset.sliderFaceEditing = "false";
    if (typeof syncNodeSliderReadout === "function") syncNodeSliderReadout(slider);
    nodeSliderReadoutEditRefreshChrome();
    return;
  }
  const readout = createNodeSliderReadoutButton(input.dataset.sliderTarget, slider, {
    paramLabel: input.dataset.paramLabel || "",
    ariaLabel: input.getAttribute("aria-label"),
    mirror: input.dataset.mirror === "true",
  });
  input.replaceWith(readout);
  syncNodeSliderReadout(slider);
  nodeSliderReadoutEditRefreshChrome();
}

function cancelNodeSliderReadoutEdit(input) {
  if (input.dataset.editCommitted === "true" || input.dataset.editCanceled === "true") {
    return;
  }
  input.dataset.editCanceled = "true";
  const slider = document.getElementById(input.dataset.sliderTarget);
  if (input.dataset.faceOverlay === "true") {
    const surface = input.parentElement;
    input.remove();
    if (surface) surface.dataset.sliderFaceEditing = "false";
    if (typeof syncNodeSliderReadout === "function") syncNodeSliderReadout(slider);
    nodeSliderReadoutEditRefreshChrome();
    return;
  }
  const readout = createNodeSliderReadoutButton(input.dataset.sliderTarget, slider, {
    paramLabel: input.dataset.paramLabel || "",
    ariaLabel: input.getAttribute("aria-label"),
    mirror: input.dataset.mirror === "true",
  });
  input.replaceWith(readout);
  syncNodeSliderReadout(slider);
  nodeSliderReadoutEditRefreshChrome();
}


/** Phone browsers fire a compatibility mouse pointerdown after a touch, and
 *  workspace capture listeners blur any input that isn't the event target.
 *  That used to commit and remove the type-in box before it could stay up.
 *  Keep the field open, focused, and typable through that residual burst. */
const NODE_SLIDER_READOUT_EDIT_OPEN_GUARD_MS = 500;

function nodeSliderReadoutEditStyleForTyping(input) {
  input.style.pointerEvents = "auto";
  input.style.userSelect = "text";
  input.style.webkitUserSelect = "text";
  input.style.touchAction = "manipulation";
  input.style.opacity = "1";
  input.style.visibility = "visible";
  input.style.background = "#080b0d";
  input.style.color = "#ffffff";
  input.style.webkitTextFillColor = "#ffffff";
  input.style.caretColor = "#ffffff";
  // 16px avoids iOS zoom-on-focus, which can hide or jump the box.
  input.style.fontSize = "16px";
}

function nodeSliderReadoutEditFocus(input) {
  try {
    input.focus({ preventScroll: true });
  } catch (_error) {
    input.focus();
  }
  try {
    input.select();
  } catch (_error) {
    /* some browsers throw if the field isn't focusable yet */
  }
}

function nodeSliderReadoutEditStillOpening(input, openedAt) {
  if (!input || input.dataset.editOpening !== "true") {
    return false;
  }
  return performance.now() - openedAt < NODE_SLIDER_READOUT_EDIT_OPEN_GUARD_MS + 50;
}

function nodeSliderReadoutEditArmPersistence(input) {
  const openedAt = performance.now();
  input.dataset.editOpening = "true";
  const closeOnOutsidePointerDown = (event) => {
    if (
      !document.contains(input)
      || input.dataset.editCommitted === "true"
      || input.dataset.editCanceled === "true"
    ) {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
      return;
    }
    if (event.target === input || input.contains?.(event.target)) {
      return;
    }
    // Residual compatibility-mouse or still-held opening finger.
    if (nodeSliderReadoutEditStillOpening(input, openedAt)) {
      return;
    }
    document.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
    commitNodeSliderReadoutEdit(input);
  };
  document.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
  input.addEventListener("blur", () => {
    if (input.dataset.editCanceled === "true" || input.dataset.editCommitted === "true") {
      return;
    }
    if (nodeSliderReadoutEditStillOpening(input, openedAt)) {
      window.setTimeout(() => {
        if (
          document.contains(input)
          && input.dataset.editCommitted !== "true"
          && input.dataset.editCanceled !== "true"
        ) {
          nodeSliderReadoutEditFocus(input);
        }
      }, 0);
      return;
    }
    commitNodeSliderReadoutEdit(input);
  });
  window.setTimeout(() => {
    if (input.dataset.editOpening === "true") {
      input.dataset.editOpening = "false";
    }
  }, NODE_SLIDER_READOUT_EDIT_OPEN_GUARD_MS);
}

function beginNodeSliderFaceValueEdit(surface) {
  if (!surface || surface.dataset.sliderFaceEditing === "true") {
    return false;
  }
  if (typeof nodeGraphPatchIsLocked === "function" && nodeGraphPatchIsLocked()) {
    return false;
  }
  const sliderId = String(surface.dataset.sliderTarget || "").trim();
  const slider = document.getElementById(sliderId);
  if (!slider) {
    return false;
  }
  const input = document.createElement("input");
  input.type = "text";
  input.className = "node-slider-readout-input node-knob-face-value-input";
  // Seed codes are text (fuckmoth, P6nC). A decimal keypad on the phone
  // cannot type them.
  input.inputMode = slider.dataset?.kind === "seed" ? "text" : "decimal";
  input.autocomplete = "off";
  input.spellcheck = false;
  const domainRaw = Number(slider.dataset?.domainValue);
  const editShown = nodeSliderEditShownValue(slider, Number.isFinite(domainRaw) ? domainRaw : Number(slider.value));
  input.value = nodeSliderChoiceLabel(slider) ?? formatNodeSliderNumber(editShown.value, {
    kind: editShown.kind,
    maxDigits: editShown.maxDigits,
    reserveSignSpace: true,
    showSign: nodeSliderShouldShowSign(slider),
  });
  input.dataset.sliderTarget = slider.id;
  input.dataset.faceOverlay = "true";
  input.setAttribute("aria-label", slider.dataset.paramLabel || "Value");
  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  for (const name of ["pointerdown", "mousedown", "click", "dblclick", "pointerup", "mouseup"]) {
    input.addEventListener(name, stop);
  }
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      commitNodeSliderReadoutEdit(input);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelNodeSliderReadoutEdit(input);
    }
  });
  const position = window.getComputedStyle(surface).position;
  if (position === "static") {
    surface.style.position = "relative";
  }
  surface.style.overflow = "visible";
  surface.style.pointerEvents = "auto";
  surface.style.zIndex = "40";
  input.style.position = "absolute";
  input.style.left = "50%";
  input.style.top = "50%";
  input.style.transform = "translate(-50%, -50%)";
  input.style.zIndex = "40";
  input.style.width = "70%";
  input.style.minWidth = "4.5em";
  input.style.minHeight = "1.6em";
  input.style.height = "auto";
  input.style.maxHeight = "none";
  nodeSliderReadoutEditStyleForTyping(input);
  surface.dataset.sliderFaceEditing = "true";
  const finishFlag = () => {
    surface.dataset.sliderFaceEditing = "false";
  };
  input.addEventListener("remove", finishFlag);
  const observer = new MutationObserver(() => {
    if (!input.isConnected) {
      finishFlag();
      observer.disconnect();
    }
  });
  observer.observe(surface, { childList: true });
  surface.append(input);
  // Force layout so the new field is a real hit target before residual events.
  void input.offsetWidth;
  nodeSliderReadoutEditArmPersistence(input);
  nodeSliderReadoutEditFocus(input);
  nodeSliderReadoutEditRefreshChrome();
  return true;
}

function beginNodeSliderReadoutEdit(readout) {
  if (typeof nodeGraphPatchIsLocked === "function" && nodeGraphPatchIsLocked()) {
    return;
  }
  readout = nodeSliderResolveLiveReadout(readout);
  if (!readout?.isConnected) {
    return;
  }
  const slider = document.getElementById(readout.dataset.sliderTarget);
  if (!slider) {
    return;
  }

  const input = document.createElement("input");
  input.type = "text";
  input.className = "node-slider-readout-input";
  input.inputMode = "text";
  input.dataset.mirror = readout.dataset.mirror || "false";
  // Prefer domainValue (may exceed HTML thumb min/max); slider.value is clamped.
  const domainRaw = Number(slider.dataset?.domainValue);
  const editShown = nodeSliderEditShownValue(slider, Number.isFinite(domainRaw) ? domainRaw : Number(slider.value));
  input.value = nodeSliderChoiceLabel(slider) ?? formatNodeSliderNumber(editShown.value, {
    kind: editShown.kind,
    maxDigits: editShown.maxDigits,
    reserveSignSpace: true,
    showSign: nodeSliderShouldShowSign(slider),
  });
  input.dataset.sliderTarget = slider.id;
  input.dataset.paramLabel = readout.dataset.paramLabel || "";
  input.setAttribute("aria-label", readout.getAttribute("aria-label"));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      commitNodeSliderReadoutEdit(input);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelNodeSliderReadoutEdit(input);
    }
  });
  nodeSliderReadoutEditStyleForTyping(input);
  // Single-click anywhere outside the input commits and closes the edit.
  // Blur alone doesn't cover this: workspace pointerdown handlers call
  // preventDefault (pan/marquee/slider-drag), which suppresses the focus
  // change so the input never blurs. Capture-phase document listener sees
  // the pointerdown regardless; it self-removes once the edit is over.
  // On phone, residual compatibility-mouse events must not close the box —
  // see nodeSliderReadoutEditArmPersistence.
  readout.replaceWith(input);
  void input.offsetWidth;
  nodeSliderReadoutEditArmPersistence(input);
  nodeSliderReadoutEditFocus(input);
  nodeSliderReadoutEditRefreshChrome();
}

function nodeSliderReadoutIsNumberOnly(readout) {
  const slider = document.getElementById(readout?.dataset?.sliderTarget);
  return slider?.dataset?.control === "number";
}

function stopNodeSliderReadoutPointer(event) {
  event.preventDefault();
  event.stopPropagation();
}

function attachNodeSliderReadoutEvents(readout) {
  readout.addEventListener("dblclick", (event) => {
    if (event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    beginNodeSliderReadoutEdit(readout);
  });
  readout.addEventListener("contextmenu", (event) => openNodeMetadataPopover(event, readout));
  if (nodeSliderReadoutIsNumberOnly(readout)) {
    readout.addEventListener("pointerdown", stopNodeSliderReadoutPointer);
    readout.addEventListener("mousedown", stopNodeSliderReadoutPointer);
    return;
  }
  readout.addEventListener("pointerdown", beginNodeSliderDrag);
  readout.addEventListener("lostpointercapture", endNodeSliderDrag);
  readout.addEventListener("mousedown", beginNodeSliderDrag);
  readout.addEventListener("keydown", stepNodeSliderFromKeyboard);
}

function createNodeSliderReadout(slider) {
  const label = slider.closest("label");
  if (!label || label.querySelector(".node-slider-readout, .node-slider-readout-input")) {
    return;
  }

  slider.dataset.mid ||= String((Number(slider.min) + Number(slider.max)) / 2);
  slider.dataset.default ||= slider.value;
  slider.dataset.step ||= slider.step || "any";
  slider.step = "any";
  slider.dataset.kind ||= "decimal";
  slider.dataset.maxDigits ||= String(nodeGraphDefaultMetadataMaxDigits(slider.dataset.kind));
  slider.dataset.unit ??= "";
  slider.dataset.choices ??= "";
  slider.dataset.displayChoices ??= "false";
  slider.dataset.divideChoicesVisibly ??= "false";
  slider.dataset.linearSmoothing ??= "true";
  slider.dataset.showSign ??= "false";
  slider.dataset.wraparound ??= "false";

  label.append(createNodeSliderReadoutButton(slider.id, slider, {
    paramLabel: label.dataset.paramLabel || nodeSliderLabelText(slider),
    ariaLabel: `${slider.id} current value`,
  }));
  syncNodeSliderReadout(slider);
}

// One readout builder for module rows, type-in restore and Command Center
// mirrors. A mirror drives the same slider input as the module row.
function createNodeSliderReadoutButton(sliderId, slider, options = {}) {
  const readout = document.createElement("button");
  readout.type = "button";
  readout.className = "node-slider-readout";
  readout.dataset.sliderTarget = sliderId;
  readout.dataset.paramLabel = options.paramLabel || "";
  readout.dataset.control = slider?.dataset?.control || "";
  readout.classList.toggle("number-only", slider?.dataset?.control === "number");
  readout.setAttribute("aria-label", options.ariaLabel || "");
  populateNodeSliderReadoutShell(readout);
  attachNodeSliderReadoutEvents(readout);
  if (options.mirror) {
    readout.dataset.mirror = "true";
    registerNodeSliderMirrorReadout(readout);
  }
  return readout;
}
