// Step Graph / Smooth Graph face: a display face like SinCos. The picture is
// the display's own .node-display-canvas, drawn with the gl-line-renderer
// shaders (display Expo edge, 4x4 supersampled stroke) into its face texture.
// The GL graph, Canvas tiles, screen solo and Mini Canvas composite that
// texture like every other display. JS samples the curve with the shared
// curve library (nodeGraphGraphValueAt) into stroke points and lays out dots
// and handles; WebGL draws every pixel. The SVG in the same display is the hit
// layer only (renderNodeGraphGraphDisplay, node-graph-graph-utils.js).

const NODE_GRAPH_GRAPH_FACE_BACKGROUND = [0.04, 0.05, 0.07, 1];

/**
 * The display's face canvas, made once. Renders keep this same element (and
 * so its face texture and published display rect) across SVG rebuilds.
 */
function nodeGraphGraphFaceGlCanvas(display) {
  if (!display) return null;
  let canvas = display._graphFaceCanvas;
  if (!canvas && typeof nodeGraphDisplayCanvasCreate === "function") {
    canvas = nodeGraphDisplayCanvasCreate("node-module-graph-canvas");
    canvas.setAttribute("aria-hidden", "true");
    display._graphFaceCanvas = canvas;
    nodeGraphGraphFaceGlInstall(display);
  }
  return canvas || null;
}

/** Live pump (playhead, modulated params), resize, and hover / hot repaints. */
function nodeGraphGraphFaceGlInstall(display) {
  if (typeof nodeGraphInstallDrawingFacePump === "function") {
    nodeGraphInstallDrawingFacePump(display, {
      clockKey: (el) => `graphFace:${el.dataset?.graphNode || ""}`,
      forceKey: "_graphFaceForceDraw",
      rafKey: "_graphFaceRaf",
      paint: drawNodeGraphGraphFace,
      paintOnCreate: false,
    });
  }
  // Hover reveal and hot point / handle / phase marks are set by the hit
  // layer's own listeners (bound first); repaint once they have run.
  const request = () => nodeGraphGraphFaceGlRequestPaint(display);
  for (const type of ["pointerenter", "pointermove", "pointerleave", "pointerdown", "pointerup", "pointercancel"]) {
    display.addEventListener(type, request);
  }
}

function nodeGraphGraphFaceGlRequestPaint(display) {
  if (!display || display._graphFacePaintFrame) return;
  display._graphFacePaintFrame = requestAnimationFrame(() => {
    display._graphFacePaintFrame = 0;
    nodeGraphGraphFaceGlPaintNow(display);
  });
}

/** Paint now (after a render / drag frame) and stamp the face quads. */
function nodeGraphGraphFaceGlPaintNow(display) {
  if (!display?._graphFaceCanvas) return;
  drawNodeGraphGraphFace(display);
  if (typeof nodeGraphGlGraphPresentDisplaysSoon === "function") nodeGraphGlGraphPresentDisplaysSoon();
}

function nodeGraphGraphFaceGlRgba(color, fallback) {
  if (Array.isArray(color) && color.length >= 3) {
    return [+color[0] || 0, +color[1] || 0, +color[2] || 0, color.length > 3 ? +color[3] : 1];
  }
  return typeof color === "string" && color.trim() && typeof nodeGraphGlLinesCss === "function"
    ? nodeGraphGlLinesCss(color)
    : fallback;
}

function nodeGraphGraphFaceGlAlpha(rgba, alpha) {
  const a = Number.isFinite(Number(alpha)) ? Math.max(0, Math.min(1, Number(alpha))) : (rgba[3] ?? 1);
  return [rgba[0] || 0, rgba[1] || 0, rgba[2] || 0, a];
}

function drawNodeGraphGraphFace(display) {
  const canvas = display?._graphFaceCanvas;
  if (!canvas || !canvas.isConnected || canvas.parentElement !== display) return;
  const nodeId = typeof nodeGraphGraphNodeIdFromDisplay === "function"
    ? nodeGraphGraphNodeIdFromDisplay(display)
    : String(display.dataset?.graphNode || "");
  const patchNode = nodeId && typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!patchNode) return;
  // Resize-owned face metrics: no layout read on the paint path.
  const face = typeof ensureFaceMetrics === "function" ? ensureFaceMetrics(display, { observe: true }) : null;
  const cssW = Number(face?.cssW) || 0;
  const cssH = Number(face?.cssH) || 0;
  if (!(cssW >= 4) || !(cssH >= 4)) {
    display._graphFaceForceDraw = true;
    if (!display._graphFaceRetryFrame) {
      display._graphFaceRetryFrame = requestAnimationFrame(() => {
        display._graphFaceRetryFrame = 0;
        nodeGraphGraphFaceGlPaintNow(display);
      });
    }
    return;
  }
  const dpr = typeof nodeGraphDisplayCanvasPixelRatio === "function"
    ? nodeGraphDisplayCanvasPixelRatio(2)
    : Math.max(1, Math.min(2, Number(window.devicePixelRatio) || 1));
  const resized = typeof nodeGraphDisplayCanvasSetBacking === "function"
    && nodeGraphDisplayCanvasSetBacking(canvas, cssW * dpr, cssH * dpr);
  // The live drag document while a point is dragged (cdaf517f), else the patch graph.
  const graph = typeof nodeGraphGraphPaintDocumentForNode === "function"
    ? nodeGraphGraphPaintDocumentForNode(patchNode)
    : (typeof nodeGraphGraphForNode === "function" ? nodeGraphGraphForNode(patchNode) : null);
  if (!graph || typeof nodeGraphGraphValueAt !== "function") return;
  const look = typeof nodeGraphGraphFaceDisplaySettingsForNode === "function"
    ? nodeGraphGraphFaceDisplaySettingsForNode(patchNode)
    : (typeof normalizeNodeGraphGraphFaceDisplaySettings === "function"
      ? normalizeNodeGraphGraphFaceDisplaySettings()
      : null);
  const smoothingMode = typeof nodeGraphGraphSmoothingModeForNode === "function"
    ? nodeGraphGraphSmoothingModeForNode(patchNode)
    : undefined;
  const tensionRaw = Number(patchNode.params ? patchNode.params.tension : undefined);
  const tension = Number.isFinite(tensionRaw) ? tensionRaw : 1;
  const segmentOptions = typeof nodeGraphGraphSegmentOptionsForNode === "function"
    ? nodeGraphGraphSegmentOptionsForNode(patchNode)
    : {};
  const stepCount = typeof nodeGraphGraphStepCountForNode === "function"
    ? nodeGraphGraphStepCountForNode(patchNode)
    : 0;
  const showHandles = typeof nodeGraphGraphShowsContourHandles === "function"
    && nodeGraphGraphShowsContourHandles(patchNode);
  // Line thickness, dots and pads grow with a Canvas tile / screen solo face.
  const ink = typeof nodeGraphGlLinesInkScale === "function" ? nodeGraphGlLinesInkScale(canvas) : 1;
  const state = {
    hovering: Boolean(display.classList?.contains("is-hover-reveal")),
    hotIndex: Number(display.dataset?.hotIndex),
    phaseHot: display.dataset?.phaseHot === "true",
    playheadX: display._graphPlayheadLive && Number.isFinite(Number(display._graphPlayheadX))
      ? Number(display._graphPlayheadX)
      : null,
  };
  const signature = JSON.stringify([
    canvas.width, canvas.height, cssW, cssH, ink, state, look, smoothingMode, tension,
    segmentOptions, stepCount, showHandles, graph.cursorX, graph.nodes,
  ]);
  if (!resized && !display._graphFaceForceDraw && display._graphFaceSignature === signature) return;
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, NODE_GRAPH_GRAPH_FACE_BACKGROUND, { scale: canvas.width / cssW })
    : null;
  if (!batch) {
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(canvas, "graph face: no shared GL device");
    return;
  }
  nodeGraphGraphFaceGlDraw(batch, {
    graph, look, smoothingMode, tension, segmentOptions, stepCount, showHandles, state,
    w: cssW, h: cssH, ink,
  });
  if (nodeGraphGlLinesEnd(batch) === false) {
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(canvas, "graph face: draw failed");
    return;
  }
  display._graphFaceSignature = signature;
  display._graphFaceForceDraw = false;
}

/** Grid, curve, skew ghost, phase cursor, playhead, handles and points, in face CSS px. */
function nodeGraphGraphFaceGlDraw(batch, f) {
  const { graph, look, smoothingMode, tension, segmentOptions, stepCount, showHandles, state, w, h, ink } = f;
  const padPx = typeof nodeGraphGraphFacePadPx === "function" ? nodeGraphGraphFacePadPx(look) : 4;
  const inset = padPx * ink;
  const padX = Math.min(inset, Math.max(0, w / 2 - 2));
  const padY = Math.min(inset, Math.max(0, h / 2 - 2));
  const innerW = Math.max(4, w - padX * 2);
  const innerH = Math.max(4, h - padY * 2);
  const zoomMin = look?.zoomMin ?? -1;
  const zoomMax = look?.zoomMax ?? 1;
  const span = zoomMax - zoomMin;
  const toX = (gx) => padX + Number(gx) * innerW;
  const toY = (gy) => padY + (1 - (span > 0 ? (Number(gy) - zoomMin) / span : 0)) * innerH;
  const lineRgba = nodeGraphGraphFaceGlRgba(look?.strokeColor, [92 / 255, 232 / 255, 212 / 255, 0.92]);
  const ghostRgba = nodeGraphGraphFaceGlAlpha(
    nodeGraphGraphFaceGlRgba(look?.ghostColor, [92 / 255, 232 / 255, 212 / 255, 0.38]),
    look?.ghostAlpha,
  );
  const dotRgba = nodeGraphGraphFaceGlRgba(look?.dotColor, [246 / 255, 246 / 255, 218 / 255, 0.88]);
  const playRgba = nodeGraphGraphFaceGlRgba(look?.playheadColor, [177 / 255, 132 / 255, 255 / 255, 1]);
  const lineW = Math.max(0, Number(look?.lineThickness) || 0);
  const dottedW = Math.max(0, Number(look?.dottedThickness) || 0);
  const dotW = Math.max(0, Number(look?.dotSize) || 0);
  const halfPx = lineW * 0.5 * ink;
  const dottedHalf = dottedW * 0.5 * ink;
  // Line blur stays in CSS px at every size (APP_POLICY 3).
  const feather = typeof nodeGraphLineSmoothingPx === "function" ? nodeGraphLineSmoothingPx(look, 1) : 1;
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const gridAlpha = num(look?.gridAlpha, 0.22);
  const dottedAlpha = num(look?.dottedAlpha, 0.52);
  const pointAlpha = num(look?.pointAlpha, 0.82);
  const handleAlpha = num(look?.handleAlpha, 0.72);
  const phaseAlpha = num(look?.phaseAlpha, 0.42);
  const baseOptions = typeof nodeGraphGraphBaseSegmentOptions === "function"
    ? nodeGraphGraphBaseSegmentOptions(segmentOptions)
    : { ...segmentOptions, skewOffset: 0, curveOffset: 0 };
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const { hovering, hotIndex, phaseHot, playheadX } = state;

  if (stepCount > 0 && gridAlpha > 0) {
    const gridRgba = [127 / 255, 199 / 255, 217 / 255, gridAlpha];
    const gridHalf = Math.max(0.25, 0.35 * ink);
    for (let step = 0; step <= stepCount; step += 1) {
      const px = toX(step / stepCount);
      nodeGraphGlLinesPolyline(batch, [px, padY, px, padY + innerH], gridHalf, feather, gridRgba);
    }
  }

  // Uniform samples plus both sides of every point's X, so held steps rise
  // straight up instead of leaning across one sample.
  const samples = Math.max(48, Math.min(256, Math.ceil(innerW)));
  const us = [];
  for (let s = 0; s < samples; s += 1) us.push(s / (samples - 1));
  for (let n = 0; n < nodes.length; n += 1) {
    const nx = Number(nodes[n]?.x);
    if (!(nx > 0 && nx < 1)) continue;
    us.push(Math.max(0, nx - 1e-4), nx);
  }
  us.sort((a, b) => a - b);
  const curve = (options) => {
    const pts = new Float32Array(us.length * 2);
    for (let i = 0; i < us.length; i += 1) {
      const v = Number(nodeGraphGraphValueAt(graph, us[i], smoothingMode, tension, options));
      pts[i * 2] = toX(us[i]);
      pts[i * 2 + 1] = toY(Number.isFinite(v) ? v : 0);
    }
    return pts;
  };

  if (hovering && dottedW > 0 && dottedAlpha > 0 && nodes.length >= 2 && typeof nodeGraphGlLinesDash === "function") {
    const dotted = [];
    for (let n = 0; n < nodes.length; n += 1) dotted.push(toX(nodes[n].x), toY(nodes[n].y));
    nodeGraphGlLinesDash(batch, dotted, dottedHalf, Math.max(1, 2.2 * ink), Math.max(1, 2.4 * ink), [0, 239 / 255, 175 / 255, dottedAlpha]);
  }

  if (lineW > 0) nodeGraphGlLinesPolyline(batch, curve(baseOptions), halfPx, feather, lineRgba);
  const skew = typeof nodeGraphGraphGlobalSkewOffset === "function"
    ? nodeGraphGraphGlobalSkewOffset(segmentOptions)
    : Number(segmentOptions?.skewOffset ?? segmentOptions?.curveOffset ?? 0);
  if (Number.isFinite(skew) && Math.abs(skew) > 1e-6 && (look?.ghostAlpha ?? 0.38) > 0 && lineW > 0) {
    nodeGraphGlLinesPolyline(batch, curve(segmentOptions), halfPx * 0.55, feather, ghostRgba);
  }

  const cursorX = Number(graph.cursorX);
  if (Number.isFinite(cursorX)) {
    const cx = toX(cursorX);
    const cursorRgba = nodeGraphGraphFaceGlAlpha(playRgba, phaseHot ? 1 : phaseAlpha);
    const cursorHalf = Math.max(0.25, Math.min(halfPx || ink, 2 * ink));
    nodeGraphGlLinesPolyline(batch, [cx, toY(zoomMin), cx, toY(zoomMax)], cursorHalf, feather, cursorRgba);
    if (hovering && typeof nodeGraphGlLinesDash === "function") {
      const cy = toY(nodeGraphGraphValueAt(graph, cursorX, smoothingMode, tension, segmentOptions));
      nodeGraphGlLinesDash(batch, [padX, cy, padX + innerW, cy], Math.max(0.25, 0.35 * ink), 2.2 * ink, 2.8 * ink, cursorRgba);
    }
  }

  if (playheadX !== null) {
    const px = toX(playheadX);
    const half = Math.max(0.25, (halfPx || ink) * 0.75);
    if (typeof nodeGraphGlLinesDash === "function") {
      nodeGraphGlLinesDash(batch, [px, toY(zoomMin), px, toY(zoomMax)], half, 2.4 * ink, 2.6 * ink, playRgba);
    } else {
      nodeGraphGlLinesPolyline(batch, [px, toY(zoomMin), px, toY(zoomMax)], half, feather, playRgba);
    }
  }

  const handleR = (dotW > 0 ? Math.max(2, dotW * 0.5 + 0.6) : 0) * ink;
  if (showHandles && handleR > 0 && typeof nodeGraphGlLinesRing === "function") {
    const handleFeather = Math.max(0.5, feather);
    const handleStroke = Math.max(0.4, 0.95 * 0.5 * ink);
    for (let index = 1; index < nodes.length; index += 1) {
      const left = nodes[index - 1];
      const right = nodes[index];
      if (!left || !right) continue;
      const hxU = left.x + (right.x - left.x) * 0.5;
      const hyU = typeof nodeGraphGraphSegmentValue === "function"
        ? nodeGraphGraphSegmentValue(graph, hxU, index - 1, smoothingMode, baseOptions)
        : (left.y + right.y) * 0.5;
      const a = hotIndex === index ? 1 : (hovering ? handleAlpha + (1 - handleAlpha) * 0.43 : handleAlpha);
      nodeGraphGlLinesRing(batch, toX(hxU), toY(hyU), handleR, handleStroke, handleFeather, [1, 236 / 255, 181 / 255, a]);
    }
  }

  const nodeR = dotW * 0.5 * ink;
  if (nodeR > 0 && typeof nodeGraphGlLinesDot === "function") {
    for (let index = 0; index < nodes.length; index += 1) {
      const a = hotIndex === index ? 1 : (hovering ? pointAlpha + (1 - pointAlpha) * 0.33 : pointAlpha);
      nodeGraphGlLinesDot(batch, toX(nodes[index].x), toY(nodes[index].y), nodeR, Math.max(0.5, feather), nodeGraphGraphFaceGlAlpha(dotRgba, a));
    }
  }
}
