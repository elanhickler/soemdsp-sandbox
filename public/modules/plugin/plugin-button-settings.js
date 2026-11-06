// Toggle and Momentary share one Display Settings set (native WebGL button,
// modules/_shared/controller-face-gl.js): stroke, rounding, Off / On caption,
// label show + Left / Middle / Right alignment, and six colors (face
// background included). Off / On text is Display Settings, not Parameter
// Settings. The label TEXT is the module's display name: stored as labelText
// but edited only in Module Options (one source of truth, same as Knob) —
// there is no Display Settings label box. Older patches' extra keys (pads,
// font sizes, label padding, corner shape) are dropped on load.

const NODE_GRAPH_PLUGIN_BUTTON_TEXT_MAX = 48;

const NODE_GRAPH_PLUGIN_BUTTON_SLIDER_FIELDS = Object.freeze(["strokeScale", "rounding"]);

const NODE_GRAPH_PLUGIN_BUTTON_COLOR_FIELDS = Object.freeze([
  "backgroundColor",
  "strokeColor",
  "inactiveColor",
  "activeColor",
  "hoverColor",
  "textColor",
]);

const NODE_GRAPH_PLUGIN_BUTTON_TEXT_FIELDS = Object.freeze(["offText", "onText"]);

const NODE_GRAPH_PLUGIN_BUTTON_LABEL_ALIGNS = Object.freeze([
  Object.freeze({ value: "left", label: "Left" }),
  Object.freeze({ value: "middle", label: "Middle" }),
  Object.freeze({ value: "right", label: "Right" }),
]);

function nodeGraphPluginButtonNormalizeLabelAlign(value, fallback = "left") {
  const key = String(value || "").trim().toLowerCase();
  if (key === "center" || key === "centre" || key === "mid") return "middle";
  return NODE_GRAPH_PLUGIN_BUTTON_LABEL_ALIGNS.some((option) => option.value === key) ? key : fallback;
}

const NODE_GRAPH_PLUGIN_BUTTON_DISPLAY_DEFAULTS = Object.freeze({
  strokeScale: 0.06,
  rounding: 0.18,
  buttonShowLabel: true,
  buttonLabelAlign: "left",
  labelText: "",
  offText: "Off",
  onText: "On",
  backgroundColor: "#000000",
  strokeColor: "#5c5071",
  inactiveColor: "#1a2228",
  activeColor: "#2f8f86",
  hoverColor: "#89bfc2",
  textColor: "#f4f7f8",
});

function nodeGraphPluginButtonIsMomentaryType(type) {
  const key = String(type || "").trim();
  return key === "momentaryButton" || key === "momentaryButtonFace";
}

function nodeGraphPluginButtonClamp01(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function nodeGraphPluginButtonNormalizeHex(value, fallback) {
  const text = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase();
  }
  return fallback;
}

function nodeGraphPluginButtonNormalizeText(value, fallback) {
  if (value == null) return fallback;
  return String(value).replace(/\s+/g, " ").trim().slice(0, NODE_GRAPH_PLUGIN_BUTTON_TEXT_MAX);
}

function normalizeNodeGraphPluginButtonDisplaySettings(settings, type) {
  const d = NODE_GRAPH_PLUGIN_BUTTON_DISPLAY_DEFAULTS;
  const src = settings && typeof settings === "object" ? settings : {};
  const momentary = nodeGraphPluginButtonIsMomentaryType(type);
  const rounding = Number(src.rounding);
  return {
    strokeScale: nodeGraphPluginButtonClamp01(src.strokeScale, d.strokeScale),
    // Legacy patches stored percent 0…100.
    rounding: nodeGraphPluginButtonClamp01(Number.isFinite(rounding) && rounding > 1 ? rounding / 100 : src.rounding, d.rounding),
    buttonShowLabel: src.buttonShowLabel !== false && src.buttonShowLabel !== "false",
    buttonLabelAlign: nodeGraphPluginButtonNormalizeLabelAlign(src.buttonLabelAlign, d.buttonLabelAlign),
    // Display name — written by Module Options only (nodeGraphControllerFaceSettingsForNode).
    labelText: nodeGraphPluginButtonNormalizeText(src.labelText, d.labelText),
    offText: nodeGraphPluginButtonNormalizeText(src.offText, momentary ? "Gate" : d.offText),
    onText: nodeGraphPluginButtonNormalizeText(src.onText, momentary ? "Gate" : d.onText),
    backgroundColor: nodeGraphPluginButtonNormalizeHex(src.backgroundColor ?? src.background, d.backgroundColor),
    strokeColor: nodeGraphPluginButtonNormalizeHex(src.strokeColor, d.strokeColor),
    inactiveColor: nodeGraphPluginButtonNormalizeHex(src.inactiveColor, d.inactiveColor),
    activeColor: nodeGraphPluginButtonNormalizeHex(src.activeColor, d.activeColor),
    hoverColor: nodeGraphPluginButtonNormalizeHex(src.hoverColor, d.hoverColor),
    textColor: nodeGraphPluginButtonNormalizeHex(src.textColor, d.textColor),
  };
}

function nodeGraphPluginButtonDisplaySettingsForNode(node) {
  return normalizeNodeGraphPluginButtonDisplaySettings(node?.traceDisplaySettings, node?.type);
}

function nodeGraphPluginButtonFaceLabels(node) {
  const patchNode = typeof node === "string" && typeof nodeGraphPatchNode === "function"
    ? nodeGraphPatchNode(node)
    : node;
  const s = nodeGraphPluginButtonDisplaySettingsForNode(patchNode);
  return { off: s.offText || "", on: s.onText || "" };
}

function nodeGraphPluginButtonFaceLabelText(node) {
  const patchNode = typeof node === "string" && typeof nodeGraphPatchNode === "function"
    ? nodeGraphPatchNode(node)
    : node;
  const s = nodeGraphPluginButtonDisplaySettingsForNode(patchNode);
  if (s.buttonShowLabel === false) return "";
  // Module Options display name (falls back to the module title), as Knob.
  if (typeof nodeGraphKnobResolvedDisplayNameForNode === "function") {
    return nodeGraphKnobResolvedDisplayNameForNode(patchNode) || "";
  }
  return typeof nodeGraphNodeDisplayName === "function" && patchNode?.id
    ? String(nodeGraphNodeDisplayName(patchNode.id) || "")
    : "";
}

/** Display Settings applied: repaint the live face. */
function applyNodeGraphPluginButtonDisplaySettingsToFace(node) {
  const id = String(node?.id || "").trim();
  if (!id) return;
  const esc = CSS.escape(id);
  document.querySelector(
    `.node-plugin-toggle-face[data-node="${esc}"], .node-plugin-momentary-face[data-node="${esc}"]`,
  )?.syncFromParameters?.();
}

function nodeGraphPluginButtonTextRowHtml(key, label, placeholder) {
  const escape = typeof nodeGraphDisplaySettingsEscapeHtml === "function"
    ? nodeGraphDisplaySettingsEscapeHtml
    : (value) => String(value ?? "");
  return `
    <label class="node-trace-display-line-burn-row" data-trace-display-control-row>
      <span>${escape(label)}</span>
      <input type="text" spellcheck="false" autocomplete="off" maxlength="${NODE_GRAPH_PLUGIN_BUTTON_TEXT_MAX}"
        data-plugin-btn-text="${escape(key)}" aria-label="${escape(label)}" placeholder="${escape(placeholder || "")}">
    </label>`;
}

function nodeGraphPluginButtonLabelAlignRowHtml() {
  const escape = typeof nodeGraphDisplaySettingsEscapeHtml === "function"
    ? nodeGraphDisplaySettingsEscapeHtml
    : (value) => String(value ?? "");
  const options = NODE_GRAPH_PLUGIN_BUTTON_LABEL_ALIGNS
    .map((option) => `<option value="${escape(option.value)}">${escape(option.label)}</option>`)
    .join("");
  return `
    <label class="node-trace-display-line-burn-row" data-trace-display-control-row>
      <span>Align</span>
      <select data-plugin-btn-choice="buttonLabelAlign" aria-label="Label alignment">${options}</select>
    </label>`;
}

function buildNodeGraphPluginButtonDisplaySettingsBodyHtml(formType) {
  const type = formType || "toggleButtonFace";
  const colorRow = (key) => nodeGraphDisplaySettingsBuildColorRowHtml(key, type);
  const fieldRow = (key) => nodeGraphDisplaySettingsBuildStepperRowHtml(key, type);
  const toggleRow = (key) => nodeGraphDisplaySettingsBuildToggleRowHtml(key);
  const momentary = nodeGraphPluginButtonIsMomentaryType(type);
  return `
    <div data-plugin-button-display-settings-panel>
      <div class="metadata-section-title">Label</div>
      <div class="metadata-field-section">${toggleRow("buttonShowLabel")}${nodeGraphPluginButtonLabelAlignRowHtml()}</div>
      <div class="metadata-section-title">Button</div>
      <div class="metadata-field-section">${NODE_GRAPH_PLUGIN_BUTTON_SLIDER_FIELDS.map(fieldRow).join("")}</div>
      <div class="metadata-field-section">${nodeGraphPluginButtonTextRowHtml("offText", "Off", momentary ? "Gate" : "Off")}${nodeGraphPluginButtonTextRowHtml("onText", "On", momentary ? "Gate" : "On")}</div>
      <div class="metadata-section-title">Colors</div>
      <div class="metadata-field-section">${(typeof nodeGraphDisplaySettingsColorRows === "function"
        ? nodeGraphDisplaySettingsColorRows(
          ["backgroundColor", "strokeColor", "textColor", "inactiveColor", "activeColor", "hoverColor"].map(colorRow),
          [3, 3],
        )
        : ["backgroundColor", "strokeColor", "textColor", "inactiveColor", "activeColor", "hoverColor"].map(colorRow).join(""))}</div>
    </div>`;
}

function syncNodeGraphPluginButtonDisplaySettingsControls(root, settings) {
  if (!root || !settings) return;
  const type = typeof nodeGraphTraceDisplaySettingsFormType === "function"
    ? nodeGraphTraceDisplaySettingsFormType()
    : "";
  const s = normalizeNodeGraphPluginButtonDisplaySettings(settings, type);
  const format = typeof formatNodeGraphTraceDisplaySetting === "function"
    ? formatNodeGraphTraceDisplaySetting
    : (value) => String(value);
  for (const key of NODE_GRAPH_PLUGIN_BUTTON_SLIDER_FIELDS) {
    const el = root.querySelector?.(`[data-trace-display-field="${key}"]`);
    if (el && document.activeElement !== el) {
      el.value = format(s[key]);
      if (el.dataset?.waterfallField) el.readOnly = true;
    }
  }
  const show = root.querySelector?.(`[data-trace-display-toggle="buttonShowLabel"]`);
  if (show) show.checked = s.buttonShowLabel !== false;
  const align = root.querySelector?.(`[data-plugin-btn-choice="buttonLabelAlign"]`);
  if (align && document.activeElement !== align) align.value = s.buttonLabelAlign;
  for (const key of NODE_GRAPH_PLUGIN_BUTTON_TEXT_FIELDS) {
    const el = root.querySelector?.(`[data-plugin-btn-text="${key}"]`);
    if (el && document.activeElement !== el) el.value = String(s[key] || "");
  }
  for (const key of NODE_GRAPH_PLUGIN_BUTTON_COLOR_FIELDS) {
    const input = root.querySelector?.(`[data-trace-display-color="${key}"]`);
    if (input) input.value = s[key];
  }
}

function bindNodeGraphPluginButtonDisplaySettingsBody(host) {
  if (!host || host.dataset.pluginBtnSettingsBound === "true") return;
  host.dataset.pluginBtnSettingsBound = "true";
  const apply = (persist, record) => {
    if (typeof markNodeGraphTraceDisplaySettingsDirty === "function") {
      markNodeGraphTraceDisplaySettingsDirty("*");
    }
    if (typeof applyNodeGraphTraceDisplaySettingsForm === "function") {
      applyNodeGraphTraceDisplaySettingsForm({ persist, record, commit: record });
    }
  };
  const isOurs = (target) => target?.closest?.(
    "[data-plugin-btn-text], [data-plugin-btn-choice], [data-trace-display-field], [data-trace-display-toggle]",
  );
  host.addEventListener("input", (event) => {
    if (isOurs(event.target)) apply("none", false);
  });
  host.addEventListener("change", (event) => {
    if (isOurs(event.target)) apply("immediate", true);
  });
}

function readNodeGraphPluginButtonDisplaySettingsForm(root, current) {
  const panel = root?.querySelector?.("[data-plugin-button-display-settings-panel]") || root;
  const type = typeof nodeGraphTraceDisplaySettingsFormType === "function"
    ? nodeGraphTraceDisplaySettingsFormType()
    : "";
  const next = { ...(current && typeof current === "object" ? current : {}) };
  for (const key of NODE_GRAPH_PLUGIN_BUTTON_SLIDER_FIELDS) {
    const input = panel?.querySelector?.(`[data-trace-display-field="${key}"]`);
    if (input) next[key] = Number(input.value);
  }
  const show = panel?.querySelector?.(`[data-trace-display-toggle="buttonShowLabel"]`);
  if (show) next.buttonShowLabel = Boolean(show.checked);
  const align = panel?.querySelector?.(`[data-plugin-btn-choice="buttonLabelAlign"]`);
  if (align) next.buttonLabelAlign = align.value;
  for (const key of NODE_GRAPH_PLUGIN_BUTTON_TEXT_FIELDS) {
    const input = panel?.querySelector?.(`[data-plugin-btn-text="${key}"]`);
    if (input) next[key] = input.value;
  }
  for (const key of NODE_GRAPH_PLUGIN_BUTTON_COLOR_FIELDS) {
    const input = panel?.querySelector?.(`[data-trace-display-color="${key}"]`);
    if (input && input.value) next[key] = input.value;
  }
  return normalizeNodeGraphPluginButtonDisplaySettings(next, type);
}
