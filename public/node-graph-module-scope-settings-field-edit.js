// Display Settings field edit / drag / steppers / toggles.
// Peeled from node-graph-module-scope-settings-ui.js (graphify community peel).
// Load after settings-form-io.js, before settings-apply.js.

/** Fine scale for Display Settings numbers: Shift or Ctrl/Cmd ×0.1, both ×0.01. Alt is ignored. */
function nodeGraphTraceDisplayNumberDragMultiplier(event) {
  return nodeGraphNumericDragMultiplier({
    shiftKey: Boolean(event?.shiftKey),
    ctrlKey: Boolean(event?.ctrlKey),
    metaKey: Boolean(event?.metaKey),
    altKey: false,
  });
}

function setNodeGraphTraceDisplayZoomEditActive(active) {
  nodeGraphMvp.waterfallZoomEditActive = Boolean(active);
}


function nodeGraphTraceDisplayFieldFromTarget(target) {
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest?.("[data-trace-display-field]") || null;
}

function setNodeGraphTraceDisplayFieldEditing(input, editing) {
  if (!input) {
    return;
  }
  if (editing && typeof nodeGraphPatchIsLocked === "function" && nodeGraphPatchIsLocked()) {
    return;
  }
  input.readOnly = !editing;
  input.classList.toggle("trace-display-field-editing", Boolean(editing));
  if (editing) {
    input.focus();
    input.select?.();
  }
}

/**
 * True only while the user is typing into a field (dblclick edit).
 * Idle steppers are readonly for drag; do NOT treat bare readOnly===false as
 * editing — fresh-mounted inputs default to writable and that used to skip
 * seeding, then each outside click "committed" the next empty field one-by-one.
 */
function nodeGraphTraceDisplayFieldIsEditing(input) {
  return Boolean(input?.classList?.contains("trace-display-field-editing"));
}

function nodeGraphTraceDisplayEditingField() {
  const root = nodeGraphTraceDisplaySettingsRoot();
  return root?.querySelector?.("[data-trace-display-field].trace-display-field-editing") || null;
}

function beginNodeGraphTraceDisplayFieldEdit(event) {
  const input = nodeGraphTraceDisplayFieldFromTarget(event.target);
  if (!input) {
    return;
  }
  if (typeof nodeGraphPatchIsLocked === "function" && nodeGraphPatchIsLocked()) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  // Commit any other field still in edit mode.
  const prev = nodeGraphTraceDisplayEditingField();
  if (prev && prev !== input && !prev.readOnly) {
    commitNodeGraphTraceDisplayFieldEdit(prev);
  }
  if (input.dataset.traceDisplayField === "zoomSeconds") {
    setNodeGraphTraceDisplayZoomEditActive(true);
  }
  setNodeGraphTraceDisplayFieldEditing(input, true);
  event.preventDefault();
  event.stopPropagation();
}

/** Commit typed value and leave edit mode (Enter / focus leave / click outside). */
function commitNodeGraphTraceDisplayFieldEdit(input) {
  if (!input || input.readOnly) {
    return;
  }
  if (typeof nodeGraphPatchIsLocked === "function" && nodeGraphPatchIsLocked()) {
    input.readOnly = true;
    input.classList.remove("trace-display-field-editing");
    if (input.dataset.traceDisplayField === "zoomSeconds") {
      setNodeGraphTraceDisplayZoomEditActive(false);
    }
    return;
  }
  setNodeGraphTraceDisplayFieldEditing(input, false);
  if (typeof markNodeGraphTraceDisplaySettingsDirty === "function") {
    markNodeGraphTraceDisplaySettingsDirty(input.dataset?.waterfallField || input.getAttribute("data-trace-display-field"));
  }
  const stored = applyNodeGraphTraceDisplaySettingsForm({ persist: "immediate", record: true });
  if (input.dataset.traceDisplayField === "zoomSeconds") {
    setNodeGraphTraceDisplayZoomEditActive(false);
  }
  // Show the value just stored. Re-reading through a schema switch that
  // missed this face used to put the factory default back in the box.
  const key = input.dataset.traceDisplayField || input.getAttribute("data-trace-display-field");
  const bag = stored && typeof stored === "object"
    ? stored
    : normalizeNodeGraphDisplaySettingsForFormType(nodeGraphTraceDisplayCurrentSettingsForFormType());
  const shown = nodeGraphDisplaySettingsFormValue(bag, key);
  const number = Number(shown);
  if (Number.isFinite(number)) {
    input.value = formatNodeGraphTraceDisplaySetting(number);
  }
}

function finishNodeGraphTraceDisplayFieldEdit(event) {
  // focusout bubbles (blur does not) — use event.target as the field that lost focus.
  const input = nodeGraphTraceDisplayFieldFromTarget(event.target);
  if (!input || input.readOnly) {
    return;
  }
  // Still focused within the same field (e.g. internal) — skip.
  const next = event.relatedTarget;
  if (next instanceof Node && input.contains(next)) {
    return;
  }
  commitNodeGraphTraceDisplayFieldEdit(input);
}

function handleNodeGraphTraceDisplayFieldEditKeydown(event) {
  const input = nodeGraphTraceDisplayFieldFromTarget(event.target);
  if (!input || input.readOnly) {
    return;
  }
  if (event.key === "Enter") {
    // Commit immediately — do not rely on blur (parent blur listeners never see it).
    event.preventDefault();
    event.stopPropagation();
    commitNodeGraphTraceDisplayFieldEdit(input);
    input.blur();
  } else if (event.key === "Escape") {
    if (input.dataset.traceDisplayField === "zoomSeconds") {
      setNodeGraphTraceDisplayZoomEditActive(false);
    }
    writeNodeGraphTraceDisplaySettingsForm(nodeGraphTraceDisplayCurrentSettingsForFormType());
    setNodeGraphTraceDisplayFieldEditing(input, false);
    input.blur();
    event.preventDefault();
    event.stopPropagation();
  } else {
    event.stopPropagation();
  }
}

/** Click / pointer outside an editing field commits it (including outside the window). */
function handleNodeGraphTraceDisplayFieldEditPointerDown(event) {
  const editing = nodeGraphTraceDisplayEditingField();
  if (!editing || editing.readOnly) {
    return;
  }
  const target = event.target;
  if (target instanceof Node && (editing === target || editing.contains(target))) {
    return;
  }
  // Allow steppers for this field without fighting the click.
  if (
    target instanceof Element
    && target.closest?.(`[data-trace-display-step-target="${editing.dataset.traceDisplayField}"]`)
  ) {
    commitNodeGraphTraceDisplayFieldEdit(editing);
    return;
  }
  commitNodeGraphTraceDisplayFieldEdit(editing);
  // Don't steal the click from other UI — just end text edit.
}

function preventNodeGraphTraceDisplayReadonlyFieldTextInteraction(event) {
  const input = nodeGraphTraceDisplayFieldFromTarget(event.target);
  if (!input || !input.readOnly) {
    return;
  }
  if (event.type === "focusin") {
    input.blur();
    return;
  }
  event.preventDefault();
}

/**
 * App-wide 0…1 unit stepper drag (gradient Pos, etc.).
 * Must run in CAPTURE on the display-settings popover: text-input protection
 * stopPropagations before the event reaches the <input>, so per-input listeners never fire.
 */
function nodeGraphUnitStepperDragInputFromTarget(target) {
  if (!(target instanceof Element)) {
    return null;
  }
  const input = target.closest?.("input[data-unit-stepper-drag], input[data-sge-pos]");
  if (!(input instanceof HTMLInputElement) || input.disabled || !input.readOnly) {
    return null;
  }
  return input;
}

function beginNodeGraphUnitStepperDrag(event) {
  if (event.button > 0 || event.detail > 1) {
    return;
  }
  if (nodeGraphMvp?.waterfallFieldDragging || nodeGraphMvp?.unitStepperDragging) {
    return;
  }
  const input = nodeGraphUnitStepperDragInputFromTarget(event.target);
  if (!input) {
    return;
  }
  if (typeof nodeGraphNumericModifierReserved === "function" && nodeGraphNumericModifierReserved(event)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const min = Number(input.dataset.unitMin);
  const max = Number(input.dataset.unitMax);
  const startValue = Number(input.value);
  nodeGraphMvp.unitStepperDragging = {
    input,
    pointerId: event.pointerId ?? null,
    startValue: Number.isFinite(startValue) ? startValue : 0,
    startX: event.clientX,
    startY: event.clientY,
    multiplier: nodeGraphTraceDisplayNumberDragMultiplier(event),
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 1,
  };
  input.classList.add("value-dragging");
  try {
    input.setPointerCapture?.(event.pointerId);
  } catch {
    // ignore
  }
  event.preventDefault();
  event.stopPropagation();
}

function dragNodeGraphUnitStepper(event) {
  const drag = nodeGraphMvp?.unitStepperDragging;
  if (
    !drag
    || (drag.pointerId !== null && event.pointerId !== undefined && drag.pointerId !== event.pointerId)
  ) {
    return;
  }
  const mult = nodeGraphTraceDisplayNumberDragMultiplier(event);
  if (mult !== drag.multiplier) {
    const live = Number(drag.input.value);
    drag.startValue = Number.isFinite(live) ? live : drag.startValue;
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    drag.multiplier = mult;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const span = drag.max - drag.min;
  let next = drag.startValue + nodeGraphPointerDragTravelDelta(
    drag.startX,
    drag.startY,
    event.clientX,
    event.clientY,
    NODE_GRAPH_DISPLAY_SETTINGS_TRAVEL_PX,
    drag.multiplier,
  ) * (Number.isFinite(span) && span > 0 ? span : 1);
  next = Math.max(drag.min, Math.min(drag.max, next));
  if (!Number.isFinite(next)) {
    next = drag.startValue;
  }
  const formatted = typeof formatNodeGraphTraceDisplaySetting === "function"
    ? formatNodeGraphTraceDisplaySetting(next)
    : String(Number(next.toFixed(4)));
  if (drag.input.value !== formatted) {
    drag.input.value = formatted;
    // Gradient editor (and other hosts) listen for this to apply clamped domain rules.
    drag.input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  event.preventDefault();
  event.stopPropagation();
}

function endNodeGraphUnitStepperDrag(event) {
  const drag = nodeGraphMvp?.unitStepperDragging;
  if (
    !drag
    || (drag.pointerId !== null && event.pointerId !== undefined && drag.pointerId !== event.pointerId)
  ) {
    return;
  }
  drag.input.classList.remove("value-dragging");
  if (event.pointerId !== undefined && drag.input.hasPointerCapture?.(event.pointerId)) {
    drag.input.releasePointerCapture(event.pointerId);
  }
  drag.input.dispatchEvent(new Event("change", { bubbles: true }));
  nodeGraphMvp.unitStepperDragging = null;
  event.preventDefault();
  event.stopPropagation();
}

function beginNodeGraphTraceDisplayFieldDrag(event) {
  if (event.button > 0 || event.detail > 1) {
    return;
  }
  // Unit steppers (gradient Pos, …) share this capture path.
  if (nodeGraphUnitStepperDragInputFromTarget(event.target)) {
    beginNodeGraphUnitStepperDrag(event);
    return;
  }
  // Music Player Time Window / Scroll Line / Trace — same capture path as
  // other Display Settings number fields (per-input binds die on remount).
  if (
    event.target?.closest?.("input[data-phosphor-number-drag]")
    && typeof nodeGraphSampleWaveformBeginNumberDrag === "function"
  ) {
    nodeGraphSampleWaveformBeginNumberDrag(event);
    return;
  }
  const input = nodeGraphTraceDisplayFieldFromTarget(event.target);
  if (!input || !input.readOnly) {
    return;
  }
  const key = input.dataset.traceDisplayField;
  const hueRow = input.closest?.("[data-hue-title-stepper]");
  if (hueRow && (event.ctrlKey || event.metaKey)) {
    const brightKey = hueRow.getAttribute("data-hue-title-step-field");
    const satKey = hueRow.getAttribute("data-hue-title-sat-field");
    if (key === brightKey) input.value = "0.5";
    else if (key === satKey) input.value = "1";
    else return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof markNodeGraphTraceDisplaySettingsDirty === "function") {
      markNodeGraphTraceDisplaySettingsDirty(key);
    }
    applyNodeGraphTraceDisplaySettingsForm({ persist: "immediate", record: true });
    return;
  }
  if (typeof nodeGraphNumericModifierReserved === "function" && nodeGraphNumericModifierReserved(event)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (key === "zoomSeconds") {
    setNodeGraphTraceDisplayZoomEditActive(true);
  }
  const spec = nodeGraphDisplaySettingsFieldSpec(key);
  const parsed = Number(input.value);
  const startValue = Number.isFinite(parsed) ? parsed : nodeGraphDisplaySettingsDefaultValue(key);
  nodeGraphMvp.waterfallFieldDragging = {
    input,
    key,
    spec,
    pointerId: event.pointerId ?? null,
    startControl: nodeGraphDisplaySettingsValueToControl(spec, startValue),
    startX: event.clientX,
    startY: event.clientY,
    // Live-updated on move; re-anchor when Shift/Ctrl scale changes.
    multiplier: nodeGraphTraceDisplayNumberDragMultiplier(event),
  };
  input.classList.add("value-dragging");
  input.setPointerCapture?.(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}

/**
 * One drag law for every Display Settings number: the app-wide diagonal travel
 * (right/up increase) over NODE_GRAPH_DISPLAY_SETTINGS_TRAVEL_PX per full
 * control range, fine ×0.1 (Shift or Ctrl/Cmd) / ×0.01 (both). The spec taper
 * maps control ↔ value; screen px, so canvas zoom does not change the gain.
 */
function dragNodeGraphTraceDisplayField(event) {
  const drag = nodeGraphMvp.waterfallFieldDragging;
  if (
    !drag ||
    (drag.pointerId !== null && event.pointerId !== undefined && drag.pointerId !== event.pointerId)
  ) {
    return;
  }
  // Re-anchor when fine modifiers change mid-drag so releasing Shift
  // does not jump as if the whole drag used the new scale.
  const currentMult = nodeGraphTraceDisplayNumberDragMultiplier(event);
  if (currentMult !== drag.multiplier) {
    const live = Number(drag.input.value);
    if (Number.isFinite(live)) {
      drag.startControl = nodeGraphDisplaySettingsValueToControl(drag.spec, live);
    }
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    drag.multiplier = currentMult;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const controlDelta = nodeGraphPointerDragTravelDelta(
    drag.startX,
    drag.startY,
    event.clientX,
    event.clientY,
    NODE_GRAPH_DISPLAY_SETTINGS_TRAVEL_PX,
    drag.multiplier,
  );
  const rawValue = nodeGraphDisplaySettingsControlToValue(drag.spec, drag.startControl + controlDelta);
  const nextValue = normalizeNodeGraphTraceDisplaySettingValueForKey(drag.key, rawValue);
  drag.input.value = formatNodeGraphTraceDisplaySetting(nextValue);
  if (typeof markNodeGraphTraceDisplaySettingsDirty === "function") {
    markNodeGraphTraceDisplaySettingsDirty(drag.key);
  }
  applyNodeGraphTraceDisplaySettingsForm({ persist: "debounce", record: false });
  event.preventDefault();
  event.stopPropagation();
}

function endNodeGraphTraceDisplayFieldDrag(event) {
  const drag = nodeGraphMvp.waterfallFieldDragging;
  if (
    !drag ||
    (drag.pointerId !== null && event.pointerId !== undefined && drag.pointerId !== event.pointerId)
  ) {
    return;
  }
  drag.input.classList.remove("value-dragging");
  const root = nodeGraphSettingsTextRootFromTarget(drag.input);
  if (root) {
    root.dataset.settingsTextPointerActive = "false";
    root.dataset.settingsTextPointerId = "";
    root.dataset.settingsTextPointerMoved = "false";
    root.dataset.settingsTextSuppressClick = "true";
    window.setTimeout(() => {
      if (root.dataset.settingsTextSuppressClick === "true") {
        root.dataset.settingsTextSuppressClick = "false";
      }
    }, 180);
  }
  if (event.pointerId !== undefined && drag.input.hasPointerCapture?.(event.pointerId)) {
    drag.input.releasePointerCapture(event.pointerId);
  }
  if (drag.key === "zoomSeconds") {
    setNodeGraphTraceDisplayZoomEditActive(false);
  }
  if (typeof markNodeGraphTraceDisplaySettingsDirty === "function") {
    markNodeGraphTraceDisplaySettingsDirty(drag.key);
  }
  applyNodeGraphTraceDisplaySettingsForm({ persist: "immediate", record: true });
  nodeGraphMvp.waterfallFieldDragging = null;
  event.preventDefault();
  event.stopPropagation();
}

/**
 * One −/+ step on the field spec: control units for log/power tapers, value
 * units for linear; integers stay whole; FFT walks its size table.
 */
function nodeGraphDisplaySettingsStepValue(spec, value, direction, fineScale = 1) {
  if (spec.table && typeof nodeGraphSpectrogramStepFftSize === "function") {
    return nodeGraphSpectrogramStepFftSize(value, direction);
  }
  if (spec.integer) {
    return Math.round(value) + direction * spec.step;
  }
  const step = spec.step * fineScale;
  if (spec.taper === "linear") {
    let next = value + direction * step;
    // Keep the step grid clean (0.9, not 0.8999…).
    next = Math.round(next / step) * step;
    next = Number(next.toFixed(10));
    return spec.wrap ? ((next - spec.min) % (spec.max - spec.min) + (spec.max - spec.min)) % (spec.max - spec.min) + spec.min : next;
  }
  return nodeGraphDisplaySettingsControlToValue(
    spec,
    nodeGraphDisplaySettingsValueToControl(spec, value) + direction * step,
  );
}

function stepNodeGraphTraceDisplaySetting(event) {
  if (nodeGraphSettingsTextGestureShouldIgnoreClick(event)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const button = event.target.closest("[data-trace-display-step-target]");
  if (!button) {
    return;
  }
  const key = button.dataset.traceDisplayStepTarget;
  const root = nodeGraphTraceDisplaySettingsRoot();
  const input = root?.querySelector?.(`[data-trace-display-field="${key}"]`)
    || button.closest("label")?.querySelector?.(`[data-trace-display-field="${key}"]`);
  if (!input) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const direction = Number(button.dataset.traceDisplayStepDirection) < 0 ? -1 : 1;
  const current = Number(input.value);
  const baseValue = Number.isFinite(current) ? current : nodeGraphDisplaySettingsDefaultValue(key);
  const nextValue = normalizeNodeGraphTraceDisplaySettingValueForKey(
    key,
    // Shift = fine ×0.1 (same direction as drag fine; not the module keyboard ×10).
    nodeGraphDisplaySettingsStepValue(nodeGraphDisplaySettingsFieldSpec(key), baseValue, direction, event.shiftKey ? 0.1 : 1),
  );
  input.value = formatNodeGraphTraceDisplaySetting(nextValue);
  if (typeof markNodeGraphTraceDisplaySettingsDirty === "function") {
    markNodeGraphTraceDisplaySettingsDirty(key);
  }
  applyNodeGraphTraceDisplaySettingsForm({ persist: "immediate", record: true });
}

/**
 * Display Settings toggles:
 *   - App latch buttons (packing row Full Dot Economy / Dots only)
 *   - Legacy checkbox labels
 *   - Clear action (wipe phosphor residual)
 */
function toggleNodeGraphTraceDisplaySettingRow(event) {
  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }
  // —— App latch button (Full Dot Economy / Dots only) ——
  const latch = event.target.closest?.("[data-latch-button][data-trace-display-toggle]");
  if (latch && !latch.disabled) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    if (typeof AppLatchButton !== "undefined") {
      AppLatchButton.toggle(latch);
    } else {
      const next = latch.getAttribute("aria-pressed") !== "true";
      latch.setAttribute("aria-pressed", next ? "true" : "false");
      latch.dataset.latchOn = next ? "1" : "0";
      latch.classList.toggle("is-on", next);
      latch.classList.toggle("is-off", !next);
    }
    latch.dataset.traceDisplayToggleOwned = "1";
    if (typeof markNodeGraphTraceDisplaySettingsDirty === "function") {
      markNodeGraphTraceDisplaySettingsDirty(
        latch.getAttribute("data-trace-display-toggle") || latch.dataset?.waterfallToggle,
      );
    }
    applyNodeGraphTraceDisplaySettingsForm({ persist: "immediate", record: true });
    window.setTimeout(() => {
      delete latch.dataset.traceDisplayToggleOwned;
    }, 0);
    return;
  }
  // —— Clear phosphor residual (action, not a setting) ——
  // Multi-select Display Settings: wipe every active target that shares this panel.
  const clearBtn = event.target.closest?.(
    "[data-trace-display-action='clearPhosphor'], [data-latch-action='clearPhosphor']",
  );
  if (clearBtn && !clearBtn.disabled) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    if (typeof clearNodeGraphDisplaySettingsPhosphor === "function") {
      // Resolve multi-select at click time (ActiveTargetIds + selection re-resolve).
      clearNodeGraphDisplaySettingsPhosphor(null, { scheduleDraw: true });
    }
    return;
  }
  // —— Legacy checkbox labels ——
  const toggleRow = event.target.closest(
    "label.metadata-checkbox-label, label[data-trace-display-control-row], .metadata-section-title",
  );
  const input = toggleRow?.querySelector?.("input[data-trace-display-toggle]");
  if (!input || input.disabled) {
    return;
  }
  // Direct hits on the checkbox (if pointer-events restored) use change handler.
  if (event.target === input || event.target?.closest?.("input[data-trace-display-toggle]")) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
  input.checked = !input.checked;
  // Guard against a late native click/change undoing the apply this gesture.
  input.dataset.traceDisplayToggleOwned = "1";
  if (typeof markNodeGraphTraceDisplaySettingsDirty === "function") {
    markNodeGraphTraceDisplaySettingsDirty(
      input.getAttribute("data-trace-display-toggle") || input.dataset?.waterfallToggle,
    );
  }
  applyNodeGraphTraceDisplaySettingsForm({ persist: "immediate", record: true });
  window.setTimeout(() => {
    delete input.dataset.traceDisplayToggleOwned;
  }, 0);
}

function suppressNodeGraphTraceDisplaySettingRowClick(event) {
  // Latch buttons handle their own click; don't suppress so focus works.
  if (event.target.closest?.("[data-latch-button]")) {
    // Still prevent double-activate from label-like wrapping (none expected).
    const latch = event.target.closest("[data-latch-button]");
    if (latch?.dataset?.waterfallToggleOwned === "1") {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }
  const toggleRow = event.target.closest(
    "label.metadata-checkbox-label, label[data-trace-display-control-row], .metadata-section-title",
  );
  const input = toggleRow?.querySelector?.("input[data-trace-display-toggle]");
  if (!input || input.disabled) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
}
