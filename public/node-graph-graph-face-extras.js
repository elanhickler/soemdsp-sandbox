// Graph face extras: display-only look/view settings + bottom point strip.
// Loads after node-graph-graph-utils.js. Code stays Graph->Code one-way.
//
// Curve Y is -1..+1 (see nodeGraphGraphValueMin/Max). Default Zoom shows that
// full range so the visual bottom is -1 (min), mid is 0, and the top is +1.
// Display settings are look/view only (zoom, thickness, colors) — the point
// strip is a module control, not a display setting.
const nodeGraphGraphFaceDisplaySettingsDefaults = Object.freeze({
  zoomMin: -1,
  zoomMax: 1,
  lineThickness: 2,
  dottedThickness: 0.7,
  dotSize: 6,
  strokeColor: "#5ce8d4",
  dotColor: "#f6f6da",
  playheadColor: "#b184ff",
  ghostColor: "rgba(92, 232, 212, 0.38)",
  ghostAlpha: 0.38,
  dottedAlpha: 0.52,
  gridAlpha: 0.22,
  pointAlpha: 0.82,
  handleAlpha: 0.72,
  phaseAlpha: 0.42,
});

function nodeGraphGraphClamp01(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

/**
 * CSS px inset so stroke, value dots, and contour rings stay inside the plate.
 * Same recipe as nodeGraphSinCosFacePadPx: max(half stroke, dot radius)
 * + blur + feather (lineSmoothing / 1px hairline) + extra.
 */
function nodeGraphGraphFacePadPx(look = {}) {
  const settings = look && typeof look === "object" ? look : {};
  const strokeW = Math.max(0, Number(settings.lineThickness) || 0);
  const dottedW = Math.max(0, Number(settings.dottedThickness) || 0);
  const dotW = Math.max(0, Number(settings.dotSize) || 0);
  const blur = Math.max(0, Number(settings.lineBlur) || 0);
  const extra = Math.max(0, Number(settings.padExtra) || 0);
  const feather = typeof nodeGraphLineSmoothingPx === "function"
    ? nodeGraphLineSmoothingPx(settings, 1)
    : Math.max(0, Number(settings.lineSmoothing) || 1);
  const lineHalf = Math.max(strokeW, dottedW) * 0.5;
  const nodeR = dotW > 0 ? Math.max(0, dotW * 0.5) : 0;
  const handleR = nodeR > 0 ? Math.max(2, nodeR + 0.6) : 0;
  return Math.max(lineHalf, nodeR, handleR) + blur + feather + extra;
}

function nodeGraphGraphFacePlotLayout(width, height, look = {}) {
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  const pad = nodeGraphGraphFacePadPx(look);
  const padX = w > 0 ? Math.min(pad, Math.max(0, w / 2 - 2)) : 0;
  const padY = h > 0 ? Math.min(pad, Math.max(0, h / 2 - 2)) : 0;
  const innerW = Math.max(0, w - padX * 2);
  const innerH = Math.max(0, h - padY * 2);
  return {
    width: w,
    height: h,
    pad,
    padX,
    padY,
    innerW,
    innerH,
    padViewX: w > 0 ? (padX / w) * 100 : 0,
    padViewY: h > 0 ? (padY / h) * 100 : 0,
    innerViewW: w > 0 ? (innerW / w) * 100 : 100,
    innerViewH: h > 0 ? (innerH / h) * 100 : 100,
  };
}

function nodeGraphGraphLayoutFromElement(element, look = {}) {
  const rect = element && element.getBoundingClientRect ? element.getBoundingClientRect() : null;
  if (rect && rect.width > 0 && rect.height > 0) {
    return nodeGraphGraphFacePlotLayout(rect.width, rect.height, look);
  }
  return nodeGraphGraphFacePlotLayout(100, 100, look);
}

let nodeGraphGraphPaintLayout = nodeGraphGraphFacePlotLayout(100, 100, nodeGraphGraphFaceDisplaySettingsDefaults);

function nodeGraphGraphClampYToZoom(value, zoomSettings, fallback = 0) {
  const zoom = normalizeNodeGraphGraphFaceDisplaySettings(zoomSettings);
  const stored = typeof nodeGraphGraphClampValue === "function"
    ? nodeGraphGraphClampValue(value, fallback)
    : Math.max(-1, Math.min(1, Number(value)));
  const n = Number.isFinite(stored) ? stored : fallback;
  return Math.max(zoom.zoomMin, Math.min(zoom.zoomMax, n));
}
let nodeGraphGraphPaintZoom = {
  zoomMin: nodeGraphGraphFaceDisplaySettingsDefaults.zoomMin,
  zoomMax: nodeGraphGraphFaceDisplaySettingsDefaults.zoomMax,
};

function nodeGraphGraphNormalizeCssColor(value, fallback) {
  const text = String(value == null ? "" : value).trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) {
    return text;
  }
  if (/^(rgba?|hsla?)\(/i.test(text)) {
    return text;
  }
  return fallback;
}

function nodeGraphGraphDeriveGhostColor(strokeColor) {
  const text = String(strokeColor || "").trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const n = parseInt(hex[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, 0.38)`;
  }
  const rgb = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i.exec(text);
  if (rgb) {
    return `rgba(${Number(rgb[1])}, ${Number(rgb[2])}, ${Number(rgb[3])}, 0.38)`;
  }
  return nodeGraphGraphFaceDisplaySettingsDefaults.ghostColor;
}

function normalizeNodeGraphGraphFaceDisplaySettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const rawMin = Number(source.zoomMin);
  const rawMax = Number(source.zoomMax);
  let zoomMin = Number.isFinite(rawMin) ? rawMin : nodeGraphGraphFaceDisplaySettingsDefaults.zoomMin;
  let zoomMax = Number.isFinite(rawMax) ? rawMax : nodeGraphGraphFaceDisplaySettingsDefaults.zoomMax;
  zoomMin = Math.max(-1, Math.min(2, zoomMin));
  zoomMax = Math.max(-1, Math.min(2, zoomMax));
  if (!(zoomMin < zoomMax)) {
    zoomMin = nodeGraphGraphFaceDisplaySettingsDefaults.zoomMin;
    zoomMax = nodeGraphGraphFaceDisplaySettingsDefaults.zoomMax;
  }
  const lineThickness = Math.max(0, Math.min(16, Number.isFinite(Number(source.lineThickness))
    ? Number(source.lineThickness)
    : nodeGraphGraphFaceDisplaySettingsDefaults.lineThickness));
  const dotSize = Math.max(0, Math.min(32, Number.isFinite(Number(source.dotSize))
    ? Number(source.dotSize)
    : nodeGraphGraphFaceDisplaySettingsDefaults.dotSize));
  const strokeColor = nodeGraphGraphNormalizeCssColor(
    source.strokeColor,
    nodeGraphGraphFaceDisplaySettingsDefaults.strokeColor,
  );
  const dotColor = nodeGraphGraphNormalizeCssColor(
    source.dotColor,
    nodeGraphGraphFaceDisplaySettingsDefaults.dotColor,
  );
  const playheadColor = nodeGraphGraphNormalizeCssColor(
    source.playheadColor,
    nodeGraphGraphFaceDisplaySettingsDefaults.playheadColor,
  );
  const derivedGhost = nodeGraphGraphDeriveGhostColor(strokeColor);
  const ghostColor = source.ghostColor == null || String(source.ghostColor).trim() === ""
    ? derivedGhost
    : nodeGraphGraphNormalizeCssColor(source.ghostColor, derivedGhost);
  const dottedThickness = Math.max(0, Math.min(16, Number.isFinite(Number(source.dottedThickness))
    ? Number(source.dottedThickness)
    : nodeGraphGraphFaceDisplaySettingsDefaults.dottedThickness));
  const colorAlpha = (css, fallback) => {
    const textColor = String(css || "");
    const rgba = /^rgba\(\s*[0-9.]+\s*,\s*[0-9.]+\s*,\s*[0-9.]+\s*,\s*([0-9.]+)/i.exec(textColor);
    if (rgba) {
      const a = Number(rgba[1]);
      if (Number.isFinite(a)) return Math.max(0, Math.min(1, a));
    }
    return fallback;
  };
  const ghostAlpha = nodeGraphGraphClamp01(
    source.ghostAlpha,
    colorAlpha(source.ghostColor, nodeGraphGraphFaceDisplaySettingsDefaults.ghostAlpha),
  );
  const dottedAlpha = nodeGraphGraphClamp01(source.dottedAlpha, nodeGraphGraphFaceDisplaySettingsDefaults.dottedAlpha);
  const gridAlpha = nodeGraphGraphClamp01(source.gridAlpha, nodeGraphGraphFaceDisplaySettingsDefaults.gridAlpha);
  const pointAlpha = nodeGraphGraphClamp01(source.pointAlpha, nodeGraphGraphFaceDisplaySettingsDefaults.pointAlpha);
  const handleAlpha = nodeGraphGraphClamp01(source.handleAlpha, nodeGraphGraphFaceDisplaySettingsDefaults.handleAlpha);
  const phaseAlpha = nodeGraphGraphClamp01(source.phaseAlpha, nodeGraphGraphFaceDisplaySettingsDefaults.phaseAlpha);
  return {
    zoomMin,
    zoomMax,
    lineThickness,
    dottedThickness,
    dotSize,
    strokeColor,
    dotColor,
    playheadColor,
    ghostColor,
    ghostAlpha,
    dottedAlpha,
    gridAlpha,
    pointAlpha,
    handleAlpha,
    phaseAlpha,
  };
}

function nodeGraphGraphFaceDisplaySettingsForNode(node) {
  return normalizeNodeGraphGraphFaceDisplaySettings(node?.traceDisplaySettings);
}

function nodeGraphGraphZoomFromDisplay(display) {
  if (!display) {
    return normalizeNodeGraphGraphFaceDisplaySettings();
  }
  const min = Number(display._nodeGraphZoomMin);
  const max = Number(display._nodeGraphZoomMax);
  if (Number.isFinite(min) && Number.isFinite(max) && min < max) {
    return { zoomMin: min, zoomMax: max };
  }
  return normalizeNodeGraphGraphFaceDisplaySettings();
}

function nodeGraphGraphStoreZoomOnDisplay(display, zoomSettings) {
  const zoom = normalizeNodeGraphGraphFaceDisplaySettings(zoomSettings);
  const layout = nodeGraphGraphLayoutFromElement(display, zoom);
  if (display) {
    display._nodeGraphZoomMin = zoom.zoomMin;
    display._nodeGraphZoomMax = zoom.zoomMax;
    display._nodeGraphPlotLayout = layout;
    applyNodeGraphGraphFaceLook(display, zoom);
  }
  nodeGraphGraphPaintZoom = zoom;
  nodeGraphGraphPaintLayout = layout;
  return zoom;
}

function applyNodeGraphGraphFaceLook(display, settings) {
  const look = normalizeNodeGraphGraphFaceDisplaySettings(settings);
  if (!display || !display.style) {
    return look;
  }
  const ghostWidth = Math.max(0, look.lineThickness * 0.55);
  const applyVars = (el) => {
    if (!el?.style) return;
    el.style.setProperty("--node-graph-line-color", look.strokeColor);
    el.style.setProperty("--node-graph-line-width", `${look.lineThickness}px`);
    el.style.setProperty("--node-graph-point-color", look.dotColor);
    el.style.setProperty("--node-graph-playhead-color", look.playheadColor);
    el.style.setProperty("--node-graph-ghost-color", look.ghostColor);
    el.style.setProperty("--node-graph-ghost-width", `${ghostWidth}px`);
    el.style.setProperty("--node-graph-dotted-width", `${look.dottedThickness}px`);
    el.style.setProperty("--node-graph-ghost-alpha", String(look.ghostAlpha));
    el.style.setProperty("--node-graph-dotted-alpha", String(look.dottedAlpha));
    el.style.setProperty("--node-graph-grid-alpha", String(look.gridAlpha));
    el.style.setProperty("--node-graph-point-alpha", String(look.pointAlpha));
    el.style.setProperty("--node-graph-handle-alpha", String(look.handleAlpha));
    el.style.setProperty("--node-graph-phase-alpha", String(look.phaseAlpha));
  };
  applyVars(display);
  const face = display.closest?.(".node-module-graph-face");
  if (face && face !== display) applyVars(face);
  const nodeRadius = Math.max(0, look.dotSize / 2);
  const hitRadius = Math.max(nodeRadius + 3, 6);
  const contourRadius = Math.max(2, nodeRadius + 0.6);
  if (typeof nodeGraphGraphScreenRoundRadii === "function") {
    const nodeRadii = nodeGraphGraphScreenRoundRadii(display, nodeRadius);
    const hitRadii = nodeGraphGraphScreenRoundRadii(display, hitRadius);
    const contourRadii = nodeGraphGraphScreenRoundRadii(display, contourRadius);
    display.querySelectorAll(".node-module-graph-node").forEach((el) => {
      el.setAttribute("rx", nodeRadii.rx.toFixed(3));
      el.setAttribute("ry", nodeRadii.ry.toFixed(3));
    });
    display.querySelectorAll(".node-module-graph-node-hit").forEach((el) => {
      el.setAttribute("rx", hitRadii.rx.toFixed(3));
      el.setAttribute("ry", hitRadii.ry.toFixed(3));
    });
    display.querySelectorAll(".node-module-graph-contour-handle").forEach((el) => {
      el.setAttribute("rx", contourRadii.rx.toFixed(3));
      el.setAttribute("ry", contourRadii.ry.toFixed(3));
    });
    display.querySelectorAll(".node-module-graph-contour-handle-hit").forEach((el) => {
      el.setAttribute("rx", hitRadii.rx.toFixed(3));
      el.setAttribute("ry", hitRadii.ry.toFixed(3));
    });
  }
  return look;
}

var nodeGraphGraphPointToSvgBase = typeof nodeGraphGraphPointToSvg === "function"
  ? nodeGraphGraphPointToSvg
  : null;

function nodeGraphGraphPointToView(x, y, zoomSettings = null, layout = null) {
  const zoom = normalizeNodeGraphGraphFaceDisplaySettings(zoomSettings || nodeGraphGraphPaintZoom);
  const plot = layout || nodeGraphGraphPaintLayout;
  const span = zoom.zoomMax - zoom.zoomMin;
  const yMapped = span > 0
    ? (normalizeNodeGraphGraphNumber(y, 0, -Infinity, Infinity) - zoom.zoomMin) / span
    : normalizeNodeGraphGraphNumber(y, 0);
  return {
    x: plot.padViewX + normalizeNodeGraphGraphNumber(x, 0) * plot.innerViewW,
    y: (100 - plot.padViewY) - yMapped * plot.innerViewH,
  };
}

nodeGraphGraphPointToSvg = function nodeGraphGraphPointToSvg(x, y, zoomSettings = null, layout = null) {
  return nodeGraphGraphPointToView(x, y, zoomSettings, layout);
}

var nodeGraphGraphCurvePathBase = typeof nodeGraphGraphCurvePath === "function"
  ? nodeGraphGraphCurvePath
  : null;

nodeGraphGraphCurvePath = function nodeGraphGraphCurvePath(graphValue, sampleCount = 96, smoothingMode, tension = 1, segmentOptions = {}, zoomSettings = null) {
  const zoom = normalizeNodeGraphGraphFaceDisplaySettings(zoomSettings || nodeGraphGraphPaintZoom);
  const prev = nodeGraphGraphPaintZoom;
  nodeGraphGraphPaintZoom = zoom;
  try {
    if (nodeGraphGraphCurvePathBase && nodeGraphGraphCurvePathBase !== nodeGraphGraphCurvePath) {
      // Rebuild with zoom-aware pointToSvg (already overridden).
    }
    const graph = normalizeNodeGraphGraph(graphValue);
    const count = Math.max(2, Math.round(nodeGraphFiniteNumber(sampleCount, 96)));
    const commands = [];
    for (let index = 0; index < count; index += 1) {
      const x = index / (count - 1);
      const y = nodeGraphGraphValueAt(graph, x, smoothingMode, tension, segmentOptions);
      const point = nodeGraphGraphPointToSvg(x, y, zoom);
      commands.push(`${index === 0 ? "M" : "L"} ${point.x.toFixed(3)} ${point.y.toFixed(3)}`);
    }
    return commands.join(" ");
  } finally {
    nodeGraphGraphPaintZoom = prev;
  }
}

nodeGraphGraphControlPolygonPath = function nodeGraphGraphControlPolygonPath(graphValue, zoomSettings = null) {
  const zoom = normalizeNodeGraphGraphFaceDisplaySettings(zoomSettings || nodeGraphGraphPaintZoom);
  const graph = normalizeNodeGraphGraph(graphValue);
  return graph.nodes
    .map((node, index) => {
      const point = nodeGraphGraphPointToSvg(node.x, node.y, zoom);
      return `${index === 0 ? "M" : "L"} ${point.x.toFixed(3)} ${point.y.toFixed(3)}`;
    })
    .join(" ");
}

var nodeGraphGraphSvgToGraphPointBase = typeof nodeGraphGraphSvgToGraphPoint === "function"
  ? nodeGraphGraphSvgToGraphPoint
  : null;

nodeGraphGraphSvgToGraphPoint = function nodeGraphGraphSvgToGraphPoint(svg, clientX, clientY, zoomSettings = null) {
  const rect = typeof nodeGraphGraphSvgPlotRect === "function"
    ? nodeGraphGraphSvgPlotRect(svg)
    : svg?.getBoundingClientRect?.();
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
    return null;
  }
  const zoom = zoomSettings
    ? normalizeNodeGraphGraphFaceDisplaySettings(zoomSettings)
    : nodeGraphGraphZoomFromDisplay(svg?.closest?.(".node-module-graph-display"));
  const span = zoom.zoomMax - zoom.zoomMin;
  const layout = nodeGraphGraphFacePlotLayout(rect.width, rect.height, zoom);
  const viewX = ((clientX - rect.left) / rect.width) * 100;
  const viewY = ((clientY - rect.top) / rect.height) * 100;
  // Clamp to the padded inner plot (not past the visible zoom window).
  const yUnit = layout.innerViewH > 0
    ? Math.max(0, Math.min(1, (100 - layout.padViewY - viewY) / layout.innerViewH))
    : 0.5;
  const xUnit = layout.innerViewW > 0
    ? (viewX - layout.padViewX) / layout.innerViewW
    : 0;
  const y = zoom.zoomMin + yUnit * span;
  return {
    x: normalizeNodeGraphGraphNumber(xUnit, 0),
    y: nodeGraphGraphClampYToZoom(y, zoom, 0),
  };
}

var nodeGraphGraphContourHandlePointBase = typeof nodeGraphGraphContourHandlePoint === "function"
  ? nodeGraphGraphContourHandlePoint
  : null;

nodeGraphGraphContourHandlePoint = function nodeGraphGraphContourHandlePoint(graph, rightIndex, smoothingMode = "segment", segmentOptions = {}, zoomSettings = null) {
  if (!nodeGraphGraphContourHandlePointBase) {
    return null;
  }
  const zoom = normalizeNodeGraphGraphFaceDisplaySettings(zoomSettings || nodeGraphGraphPaintZoom);
  const prev = nodeGraphGraphPaintZoom;
  nodeGraphGraphPaintZoom = zoom;
  try {
    return nodeGraphGraphContourHandlePointBase(graph, rightIndex, smoothingMode, segmentOptions);
  } finally {
    nodeGraphGraphPaintZoom = prev;
  }
}

var nodeGraphGraphRenderDisplayBase = typeof renderNodeGraphGraphDisplay === "function"
  ? renderNodeGraphGraphDisplay
  : null;

renderNodeGraphGraphDisplay = function renderNodeGraphGraphDisplay(element, graphValue, selectedIndex = null, options = {}) {
  if (!element || !nodeGraphGraphRenderDisplayBase) {
    return;
  }
  const nodeId = String(
    element.dataset?.graphNode
    || element.closest?.(".dsp-node")?.dataset?.node
    || "",
  ).trim();
  const ownerNode = nodeId && typeof nodeGraphPatchNode === "function"
    ? nodeGraphPatchNode(nodeId)
    : null;
  const zoom = nodeGraphGraphStoreZoomOnDisplay(
    element,
    options?.zoomSettings
      || (ownerNode ? nodeGraphGraphFaceDisplaySettingsForNode(ownerNode) : null),
  );
  const prev = nodeGraphGraphPaintZoom;
  nodeGraphGraphPaintZoom = zoom;
  try {
    nodeGraphGraphRenderDisplayBase(element, graphValue, selectedIndex, options);
  } finally {
    nodeGraphGraphPaintZoom = prev;
  }
  applyNodeGraphGraphFaceLook(element, zoom);
  if (typeof syncNodeGraphGraphPointStrip === "function") {
    syncNodeGraphGraphPointStrip(element, ownerNode, selectedIndex);
  }
  // Repaint the face picture now (drag frames show the in-flight graph).
  if (typeof nodeGraphGraphFaceGlPaintNow === "function") nodeGraphGraphFaceGlPaintNow(element);
}

function nodeGraphGraphPointStripFieldsForType(type) {
  if (String(type || "").trim() === "smoothGraph") {
    return [
      { key: "x", label: "X" },
      { key: "y", label: "Y" },
      { key: "tension", label: "Tension" },
    ];
  }
  return [
    { key: "x", label: "X" },
    { key: "y", label: "Y" },
    { key: "shape", label: "Shape", kind: "shape" },
    { key: "c", label: "Skew" },
  ];
}

function nodeGraphGraphPointStripShapeChoices() {
  const keys = (typeof NODE_GRAPH_SEGMENT_SHAPES !== "undefined" && Array.isArray(NODE_GRAPH_SEGMENT_SHAPES))
    ? NODE_GRAPH_SEGMENT_SHAPES
    : ["rational", "exponential", "log", "smoothstep", "smootherstep", "hold"];
  const labels = {
    rational: "Rational",
    exponential: "Exponential",
    log: "Log",
    smoothstep: "Smoothstep",
    smootherstep: "Smootherstep",
    hold: "Hold",
  };
  return keys.map((key) => ({ key, label: labels[key] || key }));
}

function buildNodeGraphGraphPointStrip(patchNode) {
  const strip = document.createElement("div");
  strip.className = "node-module-graph-point-strip";
  strip.dataset.graphPointStrip = "true";
  const type = String(patchNode?.type || "").trim();
  for (const field of nodeGraphGraphPointStripFieldsForType(type)) {
    const label = document.createElement("label");
    label.className = "node-module-graph-point-strip-field";
    const name = document.createElement("span");
    name.className = "node-module-graph-point-strip-label";
    name.textContent = field.label;
    let input;
    if (field.kind === "shape") {
      input = document.createElement("select");
      input.className = "node-module-graph-point-strip-input";
      for (const choice of nodeGraphGraphPointStripShapeChoices()) {
        const option = document.createElement("option");
        option.value = choice.key;
        option.textContent = choice.label;
        input.append(option);
      }
    } else {
      input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.inputMode = "decimal";
      input.className = "node-module-graph-point-strip-input";
      if (field.key === "x" || field.key === "tension") {
        input.min = "0";
        input.max = "1";
      } else if (field.key === "c") {
        input.min = "-1";
        input.max = "1";
      }
    }
    input.dataset.graphStripField = field.key;
    input.setAttribute("aria-label", field.label);
    if (field.key === "c" && typeof bindNodeGraphNativeSliderModifiers === "function") {
      // Shared mouse vocabulary: Ctrl/Cmd+click resets to 0; drag (Shift /
      // Ctrl fine) moves in the contour taper. The field shows stored c.
      bindNodeGraphNativeSliderModifiers(input, 0, {
        numberDrag: true,
        toControl: nodeGraphTaperFromContour,
        fromControl: nodeGraphContourFromTaper,
      });
    }
    label.append(name, input);
    strip.append(label);
  }
  return strip;
}

function mountNodeGraphGraphPointStrip(faceElement, patchNode) {
  if (!faceElement) {
    return null;
  }
  let strip = faceElement.querySelector(":scope > .node-module-graph-point-strip");
  const wanted = nodeGraphGraphPointStripFieldsForType(patchNode?.type).map((field) => field.key).join(",");
  if (strip && strip.dataset.graphStripFields !== wanted) {
    strip.remove();
    strip = null;
  }
  if (!strip) {
    strip = buildNodeGraphGraphPointStrip(patchNode);
    strip.dataset.graphStripFields = wanted;
    faceElement.append(strip);
    bindNodeGraphGraphPointStrip(strip);
  }
  syncNodeGraphGraphPointStrip(faceElement, patchNode);
  return strip;
}

function bindNodeGraphGraphPointStrip(strip) {
  if (!strip || strip.dataset.bound === "true") {
    return;
  }
  strip.dataset.bound = "true";
  strip.addEventListener("keydown", (event) => {
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && event.target?.dataset?.graphStripField === "c") {
      event.preventDefault();
      nudgeNodeGraphGraphPointStripContour(event.target, event.key === "ArrowUp" ? 1 : -1, event);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commitNodeGraphGraphPointStripField(event.target);
      event.target?.blur?.();
    }
  });
  strip.addEventListener("change", (event) => {
    commitNodeGraphGraphPointStripField(event.target);
  });
  // Shared field drags emit synthetic input events: apply live with no undo
  // step; the drag's closing change records one. Typing commits on change.
  strip.addEventListener("input", (event) => {
    if (!event.isTrusted) {
      commitNodeGraphGraphPointStripField(event.target, { record: false });
    }
  });
  strip.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
}

// Skew (c) arrow nudges step in the shared contour taper (same as Skew %),
// so equal presses stay usable near +-0.9..0.99. The field shows stored c.
// Shift / Ctrl = fine (nodeGraphNumericDragMultiplier).
function nudgeNodeGraphGraphPointStripContour(input, direction, event) {
  const current = Number(input.value);
  const scale = typeof nodeGraphNumericDragMultiplier === "function" ? nodeGraphNumericDragMultiplier(event) : 1;
  const u = nodeGraphTaperFromContour(Number.isFinite(current) ? current : 0) + direction * 0.01 * scale;
  input.value = String(Number(nodeGraphContourFromTaper(u).toFixed(6)));
  commitNodeGraphGraphPointStripField(input);
}

function nodeGraphGraphPointStripOwnerFromStrip(strip) {
  const display = strip?.closest?.(".node-module-graph-face")?.querySelector?.(".node-module-graph-display")
    || strip?.previousElementSibling;
  const nodeId = typeof nodeGraphGraphNodeIdFromDisplay === "function"
    ? nodeGraphGraphNodeIdFromDisplay(display)
    : String(display?.dataset?.graphNode || "").trim();
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  return { display, nodeId, patchNode };
}

function syncNodeGraphGraphPointStrip(faceOrDisplay, patchNode = null, selectedIndex = null) {
  const face = faceOrDisplay?.classList?.contains("node-module-graph-face")
    ? faceOrDisplay
    : faceOrDisplay?.closest?.(".node-module-graph-face");
  const display = face?.querySelector?.(".node-module-graph-display")
    || (faceOrDisplay?.classList?.contains("node-module-graph-display") ? faceOrDisplay : null);
  const strip = face?.querySelector?.(".node-module-graph-point-strip");
  if (!strip) {
    return;
  }
  const nodeId = typeof nodeGraphGraphNodeIdFromDisplay === "function"
    ? nodeGraphGraphNodeIdFromDisplay(display)
    : String(display?.dataset?.graphNode || "").trim();
  const owner = patchNode && String(patchNode.id || "") === nodeId
    ? patchNode
    : (typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : patchNode);
  if (!owner || (typeof nodeGraphModuleIsGraphType === "function" && !nodeGraphModuleIsGraphType(owner.type))) {
    return;
  }
  const graph = typeof nodeGraphGraphPaintDocumentForNode === "function"
    ? nodeGraphGraphPaintDocumentForNode(owner)
    : nodeGraphGraphForNode(owner);
  const index = selectedIndex == null
    ? nodeGraphGraphSelectedNodeIndex(nodeId, graph, 0)
    : nodeGraphGraphNodeIndexFromValue(graph, selectedIndex);
  const node = graph.nodes[index] || graph.nodes[0];
  const values = {
    x: node?.x,
    y: node?.y,
    c: node?.c,
    tension: Number(owner?.params?.tension),
  };
  const shapeValue = (typeof normalizeNodeGraphGraphShape === "function"
    ? normalizeNodeGraphGraphShape(node?.shape)
    : String(node?.shape || "rational"));
  for (const input of strip.querySelectorAll("[data-graph-strip-field]")) {
    if (document.activeElement === input) {
      continue;
    }
    const key = input.dataset.graphStripField;
    if (key === "shape") {
      input.value = shapeValue;
      input.disabled = false;
      continue;
    }
    const raw = values[key];
    const n = Number(raw);
    input.value = Number.isFinite(n) ? String(Number(n.toPrecision(8))) : "";
    if (key === "y") {
      const zoom = typeof nodeGraphGraphFaceDisplaySettingsForNode === "function"
        ? nodeGraphGraphFaceDisplaySettingsForNode(owner)
        : (typeof normalizeNodeGraphGraphFaceDisplaySettings === "function"
          ? normalizeNodeGraphGraphFaceDisplaySettings()
          : { zoomMin: -1, zoomMax: 1 });
      input.min = String(zoom.zoomMin);
      input.max = String(zoom.zoomMax);
    } else if (key === "c") {
      input.min = "-1";
      input.max = "1";
    }
    if (key === "x") {
      const last = graph.nodes.length - 1;
      input.readOnly = index <= 0 || index >= last;
    } else {
      input.readOnly = false;
    }
  }
  strip.dataset.selectedIndex = String(index);
}

function commitNodeGraphGraphPointStripField(input, options = {}) {
  if (!input || !input.dataset?.graphStripField) {
    return;
  }
  const strip = input.closest(".node-module-graph-point-strip");
  const { display, nodeId, patchNode: sourceNode } = nodeGraphGraphPointStripOwnerFromStrip(strip);
  if (!sourceNode || (typeof nodeGraphModuleIsGraphType === "function" && !nodeGraphModuleIsGraphType(sourceNode.type))) {
    return;
  }
  const field = input.dataset.graphStripField;
  const raw = String(input.value ?? "").trim();
  if (field !== "shape" && (raw === "" || raw === "-" || raw === "." || raw === "-." || /e$/i.test(raw) || /-$/.test(raw))) {
    return;
  }
  const value = field === "shape" ? raw : Number(raw);
  if (field !== "shape" && !Number.isFinite(value)) {
    syncNodeGraphGraphPointStrip(display, sourceNode);
    return;
  }

  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  const targetNode = patch.nodes.find((node) => node.id === nodeId);
  if (!targetNode || (typeof nodeGraphModuleIsGraphType === "function" && !nodeGraphModuleIsGraphType(targetNode.type))) {
    return;
  }
  const graph = nodeGraphGraphForNode(targetNode);
  const index = nodeGraphGraphSelectedNodeIndex(nodeId, graph, Number(strip?.dataset?.selectedIndex) || 0);

  if (field === "tension") {
    if (String(targetNode.type) !== "smoothGraph") {
      return;
    }
    targetNode.params = {
      ...(targetNode.params || {}),
      tension: normalizeNodeGraphGraphNumber(value, Number(targetNode.params?.tension) ?? 1, 0, 1),
    };
    commitNodeGraphPatch(patch, typeof nodeGraphGraphDocumentCommitOptions === "function"
      ? nodeGraphGraphDocumentCommitOptions("graph tension edited")
      : { skipLivePlan: true, softDom: true, status: "graph tension edited" });
    if (typeof scheduleNodeGraphLiveGraphData === "function") {
      scheduleNodeGraphLiveGraphData(nodeId, targetNode.graph);
    }
    if (typeof syncNodeGraphGraphDisplaysForNode === "function") {
      syncNodeGraphGraphDisplaysForNode(nodeId, targetNode);
    }
    syncNodeGraphGraphPointStrip(display, targetNode, index);
    const slider = typeof nodeGraphNodeElement === "function"
      ? nodeGraphNodeElement(nodeId)?.querySelector?.('input[data-param="tension"]')
      : null;
    if (slider && document.activeElement !== slider) {
      slider.value = String(targetNode.params.tension);
      if (typeof syncNodeSliderReadout === "function") {
        syncNodeSliderReadout(slider);
      }
    }
    return;
  }

  const nodes = graph.nodes.map((node) => ({ ...node }));
  const current = nodes[index];
  if (!current) {
    return;
  }
  if (field === "x") {
    const constrained = nodeGraphGraphConstrainedNodePoint(graph, index, { x: value, y: current.y });
    nodes[index] = normalizeNodeGraphGraphNode({ ...current, x: constrained.x }, index);
  } else if (field === "y") {
    const zoom = typeof nodeGraphGraphFaceDisplaySettingsForNode === "function"
      ? nodeGraphGraphFaceDisplaySettingsForNode(targetNode)
      : nodeGraphGraphPaintZoom;
    const nextY = nodeGraphGraphClampYToZoom(value, zoom, current.y);
    const constrained = nodeGraphGraphConstrainedNodePoint(graph, index, { x: current.x, y: nextY });
    nodes[index] = normalizeNodeGraphGraphNode({
      ...current,
      y: nodeGraphGraphClampYToZoom(constrained.y, zoom, current.y),
    }, index);
  } else if (field === "c") {
    if (!nodeGraphGraphUsesPerNodeContour(targetNode.type)) {
      return;
    }
    nodes[index] = normalizeNodeGraphGraphNode({
      ...current,
      c: nodeGraphGraphNormalizeContour(value, current.c),
    }, index);
  } else if (field === "shape") {
    if (String(targetNode.type) !== "stepGraph") {
      return;
    }
    nodes[index] = normalizeNodeGraphGraphNode({
      ...current,
      shape: typeof normalizeNodeGraphGraphShape === "function"
        ? normalizeNodeGraphGraphShape(value)
        : value,
    }, index);
  } else {
    return;
  }

  let nextGraph = normalizeNodeGraphGraph({ ...graph, nodes });
  if (typeof nodeGraphGraphEndpointYLockEnabledForNode === "function"
    && nodeGraphGraphEndpointYLockEnabledForNode(targetNode)) {
    nextGraph = nodeGraphGraphWithLockedEndpointY(nextGraph, index);
  }
  targetNode.graph = nextGraph;
  if (typeof syncNodeGraphGraphPhaseParameterFromCursor === "function") {
    syncNodeGraphGraphPhaseParameterFromCursor(targetNode);
  }
  const liveOnly = options.record === false ? { record: false, autosaveWorkingPatch: false } : {};
  commitNodeGraphPatch(patch, typeof nodeGraphGraphDocumentCommitOptions === "function"
    ? nodeGraphGraphDocumentCommitOptions("graph point edited", liveOnly)
    : { skipLivePlan: true, softDom: true, status: "graph point edited", ...liveOnly });
  if (typeof scheduleNodeGraphLiveGraphData === "function") {
    scheduleNodeGraphLiveGraphData(nodeId, targetNode.graph);
  }
  setNodeGraphGraphSelectedNodeIndex(nodeId, targetNode.graph, index);
  if (typeof syncNodeGraphGraphDisplaysForNode === "function") {
    syncNodeGraphGraphDisplaysForNode(nodeId, targetNode);
  }
  syncNodeGraphGraphPointStrip(display, targetNode, index);
  if (typeof syncNodeGraphGraphControls === "function") {
    syncNodeGraphGraphControls(targetNode.graph, index, { nodeId, face: false });
  }
}
