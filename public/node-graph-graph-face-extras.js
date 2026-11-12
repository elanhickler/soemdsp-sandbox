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
  dotSize: 6,
  strokeColor: "#5ce8d4",
  dotColor: "#f6f6da",
  playheadColor: "#b184ff",
  ghostColor: "rgba(92, 232, 212, 0.38)",
});

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
  const ghostColor = source.ghostColor == null || String(source.ghostColor).trim() === ""
    ? nodeGraphGraphDeriveGhostColor(strokeColor)
    : nodeGraphGraphNormalizeCssColor(source.ghostColor, nodeGraphGraphDeriveGhostColor(strokeColor));
  return {
    zoomMin,
    zoomMax,
    lineThickness,
    dotSize,
    strokeColor,
    dotColor,
    playheadColor,
    ghostColor,
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
  if (display) {
    display._nodeGraphZoomMin = zoom.zoomMin;
    display._nodeGraphZoomMax = zoom.zoomMax;
    applyNodeGraphGraphFaceLook(display, zoom);
  }
  nodeGraphGraphPaintZoom = zoom;
  return zoom;
}

function applyNodeGraphGraphFaceLook(display, settings) {
  const look = normalizeNodeGraphGraphFaceDisplaySettings(settings);
  if (!display || !display.style) {
    return look;
  }
  const ghostWidth = Math.max(0, look.lineThickness * 0.55);
  display.style.setProperty("--node-graph-line-color", look.strokeColor);
  display.style.setProperty("--node-graph-line-width", `${look.lineThickness}px`);
  display.style.setProperty("--node-graph-point-color", look.dotColor);
  display.style.setProperty("--node-graph-playhead-color", look.playheadColor);
  display.style.setProperty("--node-graph-ghost-color", look.ghostColor);
  display.style.setProperty("--node-graph-ghost-width", `${ghostWidth}px`);
  const face = display.closest?.(".node-module-graph-face");
  if (face?.style) {
    face.style.setProperty("--node-graph-line-color", look.strokeColor);
    face.style.setProperty("--node-graph-line-width", `${look.lineThickness}px`);
    face.style.setProperty("--node-graph-point-color", look.dotColor);
    face.style.setProperty("--node-graph-playhead-color", look.playheadColor);
    face.style.setProperty("--node-graph-ghost-color", look.ghostColor);
    face.style.setProperty("--node-graph-ghost-width", `${ghostWidth}px`);
  }
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

nodeGraphGraphPointToSvg = function nodeGraphGraphPointToSvg(x, y, zoomSettings = null) {
  const zoom = normalizeNodeGraphGraphFaceDisplaySettings(zoomSettings || nodeGraphGraphPaintZoom);
  const span = zoom.zoomMax - zoom.zoomMin;
  const yMapped = span > 0
    ? (normalizeNodeGraphGraphNumber(y, 0, -Infinity, Infinity) - zoom.zoomMin) / span
    : normalizeNodeGraphGraphNumber(y, 0);
  return {
    x: 8 + normalizeNodeGraphGraphNumber(x, 0) * 84,
    y: 92 - yMapped * 84,
  };
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
    return { x: 0, y: 0 };
  }
  const zoom = zoomSettings
    ? normalizeNodeGraphGraphFaceDisplaySettings(zoomSettings)
    : nodeGraphGraphZoomFromDisplay(svg?.closest?.(".node-module-graph-display"));
  const span = zoom.zoomMax - zoom.zoomMin;
  const viewX = ((clientX - rect.left) / rect.width) * 100;
  const viewY = ((clientY - rect.top) / rect.height) * 100;
  // Clamp to the inner 84×84 plot (not the 8-unit pad, and not past the
  // visible zoom window). Otherwise Y=-1 sits below a 0..1 zoomed face.
  const yUnit = Math.max(0, Math.min(1, (92 - viewY) / 84));
  const y = zoom.zoomMin + yUnit * span;
  return {
    x: normalizeNodeGraphGraphNumber((viewX - 8) / 84),
    y: typeof nodeGraphGraphClampValue === "function"
      ? nodeGraphGraphClampValue(y, 0)
      : normalizeNodeGraphGraphNumber(y, 0, -1, 1),
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
      input.className = "node-module-graph-point-strip-input node-module-graph-point-strip-select";
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
    }
    input.dataset.graphStripField = field.key;
    input.setAttribute("aria-label", field.label);
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
    if (event.key === "Enter") {
      event.preventDefault();
      commitNodeGraphGraphPointStripField(event.target);
      event.target?.blur?.();
    }
  });
  strip.addEventListener("change", (event) => {
    commitNodeGraphGraphPointStripField(event.target);
  });
  strip.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
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
  const graph = nodeGraphGraphForNode(owner);
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
    if (key === "x") {
      const last = graph.nodes.length - 1;
      input.readOnly = index <= 0 || index >= last;
    } else {
      input.readOnly = false;
    }
  }
  strip.dataset.selectedIndex = String(index);
}

function commitNodeGraphGraphPointStripField(input) {
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
    commitNodeGraphPatch(patch, { status: "graph tension edited" });
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
    const constrained = nodeGraphGraphConstrainedNodePoint(graph, index, { x: current.x, y: value });
    nodes[index] = normalizeNodeGraphGraphNode({ ...current, y: constrained.y }, index);
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
  commitNodeGraphPatch(patch, { status: "graph point edited" });
  setNodeGraphGraphSelectedNodeIndex(nodeId, targetNode.graph, index);
  if (typeof syncNodeGraphGraphDisplaysForNode === "function") {
    syncNodeGraphGraphDisplaysForNode(nodeId, targetNode);
  }
  syncNodeGraphGraphPointStrip(display, targetNode, index);
  if (typeof syncNodeGraphGraphControls === "function") {
    syncNodeGraphGraphControls(targetNode.graph, index, { nodeId, face: false });
  }
}
