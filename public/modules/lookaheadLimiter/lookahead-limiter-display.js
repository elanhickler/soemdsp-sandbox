// Gain / ducking face, shared by Pump Limiter (limiter) and Sidechain
// (sidechain): a history line of the selected display source, dipping from the
// top as the module reduces. Source "Gain" (1 = no reduction) or "Envelope" /
// "Env" (duck amount, 0 = none); both plot reduction = depth below the top.
// Reads existing outputs through the normal display source (no worklet case);
// does not change DSP.
//
// Drawing: WebGL2 via the shared line renderer (public/lib/visual/gl-line-renderer.js
// on picture-device.js): shader-expanded capsule quads with a smoothstep edge,
// blitted into the face's 2D canvas (shared sizing). No 2D drawing fallback: if
// GL can't run the face is a plain black square.

const nodeGraphLimiterGainFaceSettingsDefaults = Object.freeze({
  historySeconds: 2,
  lineThickness: 2,
  hue: 42,
  lineBrightness: 0.5,
  backgroundColor: "#020407",
});

function normalizeNodeGraphLimiterGainFaceSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const historyRaw = Number(source.historySeconds ?? source.history);
  const thicknessRaw = Number(source.lineThickness ?? source.thickness);
  const hueRaw = Number(source.hue);
  const brightRaw = Number(source.lineBrightness ?? source.brightness);
  const maxHistory = Number(typeof nodeGraphTraceDisplayMaxZoomSeconds !== "undefined"
    ? nodeGraphTraceDisplayMaxZoomSeconds
    : 10);
  let backgroundColor = String(source.backgroundColor || source.background || "").trim();
  if (!/^#[0-9a-f]{6}$/i.test(backgroundColor)) {
    backgroundColor = nodeGraphLimiterGainFaceSettingsDefaults.backgroundColor;
  }
  return {
    historySeconds: Number.isFinite(historyRaw)
      ? Math.max(0.05, Math.min(maxHistory, historyRaw))
      : nodeGraphLimiterGainFaceSettingsDefaults.historySeconds,
    lineThickness: Number.isFinite(thicknessRaw)
      ? Math.max(0.5, Math.min(12, thicknessRaw))
      : nodeGraphLimiterGainFaceSettingsDefaults.lineThickness,
    hue: Number.isFinite(hueRaw)
      ? ((hueRaw % 360) + 360) % 360
      : nodeGraphLimiterGainFaceSettingsDefaults.hue,
    lineBrightness: Number.isFinite(brightRaw)
      ? Math.max(0, Math.min(1, brightRaw))
      : nodeGraphLimiterGainFaceSettingsDefaults.lineBrightness,
    backgroundColor: backgroundColor.toLowerCase(),
  };
}

function nodeGraphLimiterGainFaceSettingsForNode(node) {
  return normalizeNodeGraphLimiterGainFaceSettings(node?.traceDisplaySettings);
}

function buildNodeGraphLimiterGainDisplaySettingsBodyHtml() {
  const colorRow = typeof nodeGraphDisplaySettingsBuildColorRowHtml === "function"
    ? nodeGraphDisplaySettingsBuildColorRowHtml("backgroundColor", "limiterGainFace")
    : "";
  return `
    <div class="node-led-display-settings-panel" data-limiter-gain-display-settings-panel>
      <label class="node-led-settings-row">
        <span>History</span>
        <input type="range" min="0.05" max="10" step="0.05" data-limiter-gain-field="historySeconds" aria-label="Limiter gain history in seconds">
        <span>s</span>
      </label>
      <label class="node-led-settings-row">
        <span>Line thickness</span>
        <input type="range" min="0.5" max="12" step="0.25" data-limiter-gain-field="lineThickness" aria-label="Limiter gain line thickness">
        <span>px</span>
      </label>
      <label class="node-led-settings-row">
        <span>Line hue</span>
        <input type="range" min="0" max="360" step="1" data-limiter-gain-field="hue" aria-label="Limiter gain line hue">
      </label>
      <label class="node-led-settings-row">
        <span>Line brightness</span>
        <input type="range" min="0" max="1" step="0.01" data-limiter-gain-field="lineBrightness" aria-label="Limiter gain line brightness">
      </label>
      ${colorRow}
    </div>`;
}

function syncNodeGraphLimiterGainDisplaySettingsControls(root, settings) {
  if (!root || !settings) {
    return;
  }
  const setRange = (key, value) => {
    const el = root.querySelector?.(`[data-limiter-gain-field="${key}"]`);
    if (el && document.activeElement !== el) {
      el.value = String(value);
    }
  };
  setRange("historySeconds", settings.historySeconds);
  setRange("lineThickness", settings.lineThickness);
  setRange("hue", settings.hue);
  setRange("lineBrightness", settings.lineBrightness);
  const color = root.querySelector?.(`[data-trace-display-color="backgroundColor"]`);
  if (color) {
    color.value = settings.backgroundColor;
  }
}

function bindNodeGraphLimiterGainDisplaySettingsBody(host) {
  if (!host || host.dataset.limiterGainSettingsBound === "true") {
    return;
  }
  host.dataset.limiterGainSettingsBound = "true";
  const apply = (persist) => {
    if (typeof markNodeGraphTraceDisplaySettingsDirty === "function") {
      markNodeGraphTraceDisplaySettingsDirty([
        "historySeconds",
        "lineThickness",
        "hue",
        "lineBrightness",
        "backgroundColor",
      ]);
    }
    if (typeof applyNodeGraphTraceDisplaySettingsForm === "function") {
      applyNodeGraphTraceDisplaySettingsForm({ persist, record: persist === "immediate" });
    }
  };
  host.addEventListener("input", (event) => {
    if (event.target?.closest?.("[data-limiter-gain-field]")) {
      apply("debounce");
    }
  });
  host.addEventListener("change", (event) => {
    if (event.target?.closest?.("[data-limiter-gain-field]")) {
      apply("immediate");
    }
  });
  if (typeof bindNodeGraphNativeSliderModifiers === "function") {
    const defaults = nodeGraphLimiterGainFaceSettingsDefaults;
    for (const [key, fallback] of Object.entries({
      historySeconds: defaults.historySeconds,
      lineThickness: defaults.lineThickness,
      hue: defaults.hue,
      lineBrightness: defaults.lineBrightness,
    })) {
      const input = host.querySelector(`[data-limiter-gain-field="${key}"]`);
      if (input) {
        bindNodeGraphNativeSliderModifiers(input, fallback);
      }
    }
  }
}

function nodeGraphLimiterGainFaceHexRgba(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
  const v = m ? parseInt(m[1], 16) : 0x020407;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, 1];
}

/** Line colour from hue (deg) + brightness 0..1 (HSL, 90% saturation). */
function nodeGraphLimiterGainFaceLineRgba(settings) {
  const d = nodeGraphLimiterGainFaceSettingsDefaults;
  const hue = Number.isFinite(Number(settings?.hue)) ? Number(settings.hue) : d.hue;
  const lRaw = Number(settings?.lineBrightness);
  const l = Math.max(0, Math.min(1, Number.isFinite(lRaw) ? lRaw : d.lineBrightness)) * 0.9 + 0.05;
  const s = 0.9;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((hue % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const rgb = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m, 1];
}

/** Display source is a duck amount (0 = none) rather than a gain (1 = none). */
function nodeGraphLimiterGainFaceSourceIsDuck(slot) {
  const source = typeof nodeGraphModuleDisplaySourceForSlot === "function"
    ? nodeGraphModuleDisplaySourceForSlot(slot)
    : null;
  const v = String(source?.value || "").trim().toLowerCase();
  return v === "envelope" || v === "env";
}

/**
 * Pure geometry: polyline points (device px) for `columns` columns of the
 * newest `count` samples. Each sample -> reduction r in 0..1, y = r * (h - 1).
 */
function nodeGraphLimiterGainFacePoints(buffer, count, w, h, duck) {
  const columns = Math.max(2, w | 0);
  const pts = new Array(columns * 2);
  const start = Math.max(0, (buffer?.length || 0) - count);
  for (let x = 0; x < columns; x += 1) {
    let r = 0;
    if (buffer?.length && count >= 2) {
      const t = x / (columns - 1);
      const raw = Number(buffer[start + Math.min(count - 1, Math.floor(t * (count - 1)))]);
      const v = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : (duck ? 0 : 1);
      r = duck ? v : 1 - v;
    }
    pts[x * 2] = x + 0.5;
    pts[x * 2 + 1] = r * (h - 1) + 0.5;
  }
  return pts;
}

function drawNodeGraphLimiterGainFaceItem(renderer, item, pixelRatio) {
  const slot = item?.slot;
  const screenElement = item?.screenElement || slot?.scopeElement;
  if (!slot || !screenElement) {
    return;
  }
  if (
    typeof nodeGraphElementInSkippedContentVisibility === "function"
    && nodeGraphElementInSkippedContentVisibility(screenElement)
  ) {
    return;
  }
  const canvas = typeof nodeGraphModuleScopeLocalFallbackCanvas === "function"
    ? nodeGraphModuleScopeLocalFallbackCanvas(slot)
    : null;
  if (
    !canvas
    || typeof syncNodeGraphModuleScopeLocalFallbackCanvas !== "function"
    || !syncNodeGraphModuleScopeLocalFallbackCanvas(canvas, screenElement, pixelRatio)
  ) {
    return;
  }
  const node = typeof nodeGraphModuleScopeNodeForSlot === "function"
    ? nodeGraphModuleScopeNodeForSlot(slot)
    : (typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(slot.nodeId) : null);
  const settings = nodeGraphLimiterGainFaceSettingsForNode(node);
  const duck = nodeGraphLimiterGainFaceSourceIsDuck(slot);
  const w = canvas.width;
  const h = canvas.height;
  const buffer = item?.buffer;
  const available = typeof nodeGraphScopeAvailableSampleCount === "function"
    ? nodeGraphScopeAvailableSampleCount(buffer)
    : (buffer?.length || 0);
  const rate = typeof nodeGraphScopeSampleRate === "function"
    ? nodeGraphScopeSampleRate(buffer)
    : 12000;
  const want = Math.max(2, Math.ceil(Math.max(0.05, settings.historySeconds) * Math.max(1, rate)));
  const count = Math.min(available, want);

  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, nodeGraphLimiterGainFaceHexRgba(settings.backgroundColor))
    : null;
  const dpr = Math.max(1, Number(pixelRatio) || 1);
  if (batch) {
    nodeGraphGlLinesPolyline(
      batch,
      nodeGraphLimiterGainFacePoints(buffer, count, w, h, duck),
      Math.max(0.5, settings.lineThickness * dpr * 0.5),
      1,
      nodeGraphLimiterGainFaceLineRgba(settings),
    );
  }
  if (!batch || !nodeGraphGlLinesEnd(batch, "alpha")) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
  }

  let reduction = 0;
  if (buffer?.length) {
    const v = Math.max(0, Math.min(1, Number(buffer[buffer.length - 1]) || 0));
    reduction = duck ? v : 1 - v;
  }
  if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
    nodeGraphModuleScopeMarkScreenLit(screenElement, Math.max(0.12, 0.18 + reduction * 0.75));
  }
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.limiterGainFace = drawNodeGraphLimiterGainFaceItem;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeNodeGraphLimiterGainFaceSettings,
    nodeGraphLimiterGainFacePoints,
    nodeGraphLimiterGainFaceLineRgba,
    nodeGraphLimiterGainFaceHexRgba,
  };
}
