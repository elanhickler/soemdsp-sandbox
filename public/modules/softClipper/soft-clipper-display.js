// Soft Clipper face -- observer-only transfer curve (Threshold / Knee visual).
// Mirrors native soft_clipper.cpp shaping for display; does not process audio.

function createNodeGraphSoftClipperCurveDisplay(nodeId, type) {
  const id = nodeId && typeof nodeId === "object"
    ? String(nodeId.dataset?.node || nodeId.id || "")
    : String(nodeId || "");
  const section = document.createElement("section");
  // Plate class for layout CSS only -- never claim filterCurve ownership.
  // Filter drawer paints data-face-kind=filterCurve exclusively (B-056).
  section.className = "node-filter-curve-display node-soft-clipper-curve-display node-module-face";
  if (typeof markCurveFacePlate === "function") {
    markCurveFacePlate(section, "softClipperCurve");
  } else {
    section.dataset.faceKind = "softClipperCurve";
    section.setAttribute("data-face-kind", "softClipperCurve");
  }
  section.dataset.node = id;
  section.dataset.nodeType = type || "softClipper";
  section.dataset.parameterVisual = "true";
  section.syncFromParameters = () => {
    section._softClipForceDraw = true;
    if (typeof syncFaceMetrics === "function") {
      syncFaceMetrics(section);
    }
    drawNodeGraphSoftClipperCurveDisplay(section);
  };
  const canvas = nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-soft-clipper-curve-canvas");
  section.append(canvas);
  if (typeof ResizeObserver === "function" && !section._softClipResizeObs) {
    const ro = new ResizeObserver(() => {
      if (!section.isConnected) return;
      if (typeof syncFaceMetrics === "function") syncFaceMetrics(section);
      section._softClipForceDraw = true;
      drawNodeGraphSoftClipperCurveDisplay(section);
    });
    try {
      ro.observe(section);
      section._softClipResizeObs = ro;
    } catch (_error) {
      // Ignore.
    }
  }
  requestAnimationFrame(() => drawNodeGraphSoftClipperCurveDisplay(section));
  return section;
}

function nodeGraphSoftClipperLiveParam(node, key, fallback = 0) {
  if (typeof nodeGraphFilterCurveLiveParam === "function") {
    return nodeGraphFilterCurveLiveParam(node, key, fallback);
  }
  const n = Number(node?.params?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

// Display twin of soft_clipper.cpp shape_one (params only -- not audio DSP).
function nodeGraphSoftClipperTransferY(x, drive, threshold, knee, amplitude) {
  const d = Math.max(0, Number.isFinite(drive) ? drive : 0.5);
  let thr = Number.isFinite(threshold) ? threshold : 0;
  thr = thr < 0 ? 0 : thr > 1 ? 1 : thr;
  let kn = Number.isFinite(knee) ? knee : 1;
  kn = kn < 0 ? 0 : kn > 1 ? 1 : kn;
  let amp = Number.isFinite(amplitude) ? amplitude : 1;
  amp = amp < 0 ? 0 : amp > 1 ? 1 : amp;
  const xin = x * d;
  const ax = Math.abs(xin);
  const sign = xin < 0 ? -1 : 1;
  if (ax <= thr) return amp * xin;
  if (kn <= 1e-4) return amp * sign * thr;
  const span = Math.max(1e-6, 1 - thr);
  const knSafe = Math.max(1e-4, kn);
  const width = 2 * span * knSafe;
  const safeWidth = Math.abs(width) > 1e-6 ? Math.abs(width) : 2;
  const sx = 2 / safeWidth;
  const shx = -1 - (sx * (0 - 0.5 * safeWidth));
  const sy = 1 / sx;
  const shy = -shx * sy;
  const excess = ax - thr;
  const u = sx * excess + shx;
  const r = Math.sqrt(1 + u * u);
  const tanhApprox = r <= 0 ? 0 : u / r;
  const y = shy + sy * tanhApprox;
  const shaped = sy > 1e-12 ? y * (span / sy) : 0;
  return amp * sign * (thr + shaped);
}

function drawNodeGraphSoftClipperCurveDisplay(section) {
  try {
    drawNodeGraphSoftClipperCurveDisplayInner(section);
  } catch (error) {
    const detail = error && typeof error === "object"
      ? (error.message || error.name || String(error))
      : String(error);
    console.error("[soft-clipper-curve] draw failed", detail, error);
  }
}

function drawNodeGraphSoftClipperCurveDisplayInner(section) {
  const node = typeof nodeGraphPatchNode === "function"
    ? nodeGraphPatchNode(section?.dataset?.node || "")
    : null;
  const canvas = section?.querySelector?.(".node-soft-clipper-curve-canvas");
  if (!node || !canvas) return;

  const metrics = typeof nodeGraphSizeDisplayCanvas === "function"
    ? nodeGraphSizeDisplayCanvas(section, canvas)
    : null;
  if (!metrics) return;
  const { cssHeight: height, cssWidth: width, pixelRatio } = metrics;

  const drive = nodeGraphSoftClipperLiveParam(node, "drive", 0.5);
  const threshold = nodeGraphSoftClipperLiveParam(node, "threshold", 0);
  const knee = nodeGraphSoftClipperLiveParam(node, "knee", 1);
  const amplitude = nodeGraphSoftClipperLiveParam(node, "amplitude", 1);
  const signature = `${drive}|${threshold}|${knee}|${amplitude}|${width}|${height}`;
  if (
    section._softClipSignature === signature
    && !section._softClipForceDraw
  ) {
    return;
  }

  // Native GL face on the shared device; translucent plate, CSS-px coords.
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, [2 / 255, 6 / 255, 9 / 255, 0.88], { scale: pixelRatio, transparent: true })
    : null;
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "soft clipper curve: no shared GL device");
    return;
  }
  const fine = 1 / Math.max(1, pixelRatio);
  const line = (x0, y0, x1, y1, rgba) => nodeGraphGlLinesSegment(batch, x0, y0, x1, y1, 0.5, fine, rgba);
  // 4-on / 4-off vertical dash (was setLineDash([4, 4])).
  const dashV = (x, rgba) => {
    for (let y = 0; y < height; y += 8) line(x, y, x, Math.min(height, y + 4), rgba);
  };

  const grid = [127 / 255, 199 / 255, 217 / 255, 0.18];
  for (let row = 0; row <= 4; row += 1) {
    const y = (row / 4) * height;
    line(0, y, width, y, grid);
  }
  line(width * 0.5, 0, width * 0.5, height, grid);
  line(0, height * 0.5, width, height * 0.5, grid);

  const xMin = -1.25;
  const xMax = 1.25;
  const yMin = -1.25;
  const yMax = 1.25;
  const toX = (x) => ((x - xMin) / (xMax - xMin)) * width;
  const toY = (y) => (1 - (y - yMin) / (yMax - yMin)) * height;

  const thr = Math.max(0, Math.min(1, threshold));
  const kn = Math.max(0, Math.min(1, knee));
  const thrRgba = [226 / 255, 168 / 255, 109 / 255, 0.55];
  dashV(toX(thr), thrRgba);
  dashV(toX(-thr), thrRgba);
  const kneeEnd = thr + (1 - thr) * kn;
  if (kn > 1e-4 && Math.abs(kneeEnd - thr) > 1e-4) {
    const kneeRgba = [160 / 255, 1, 180 / 255, 0.4];
    dashV(toX(kneeEnd), kneeRgba);
    dashV(toX(-kneeEnd), kneeRgba);
  }

  line(toX(xMin), toY(xMin), toX(xMax), toY(xMax), [127 / 255, 199 / 255, 217 / 255, 0.28]);

  const pts = Math.max(64, Math.floor(width));
  const curveW = typeof nodeGraphFaceStrokeWidth === "function"
    ? nodeGraphFaceStrokeWidth(section, 1.5)
    : 1.5;
  const curve = [];
  for (let i = 0; i < pts; i += 1) {
    const t = i / (pts - 1);
    const x = xMin + t * (xMax - xMin);
    const y = nodeGraphSoftClipperTransferY(x, drive, threshold, knee, amplitude);
    curve.push(toX(x), toY(y));
  }
  nodeGraphGlLinesPolyline(batch, curve, curveW * 0.5, fine, [160 / 255, 1, 180 / 255, 1]);
  if (!nodeGraphGlLinesEnd(batch, "alpha")) {
    nodeGraphDisplayGlFailed(canvas, "soft clipper curve: GL present failed");
    return;
  }

  section._softClipSignature = signature;
  section._softClipForceDraw = false;
}
