// Phosphillator — draw a shape freehand with the mouse, get an open-path
// X/Y drawing back. Capture uses Papoulis-smoothed pointer stream + cubic
// (Catmull-Rom) uniform-arclength resampling into a fixed-length open path
// stored on the patch node. Playback walks that path with a Jerobeam-style
// trisaw sharpness morph: 0% reverse-saw (end→start + jump), 50% triangle
// (forward then reverse back to start), 100% forward-saw (start→end + jump).

const nodeGraphPhosphillatorCaptureStates = new Map();
const nodeGraphPhosphillatorResampledPointCount = 256;
const nodeGraphPhosphillatorDrawIntensity = 24;

function normalizeNodeGraphPhosphillatorDrawnPath(drawnPath) {
  const rawPoints = Array.isArray(drawnPath?.points) ? drawnPath.points : [];
  const points = rawPoints
    .filter((value) => Number.isFinite(value))
    .slice(0, nodeGraphPhosphillatorResampledPointCount);
  return points.length >= 3 ? { points } : null;
}

// Mouse smooth uses the shared PrettyScope helper (node-graph-papoulis-filter.js).
function createNodeGraphPhosphillatorCaptureState() {
  return {
    mouseSmooth: typeof createNodeGraphMouseSmoothState === "function"
      ? createNodeGraphMouseSmoothState(0, 0)
      : null,
    points: [],
  };
}

function nodeGraphPhosphillatorPointerToNormalized(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const px = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  const py = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  return {
    x: clampNodeSliderValue(px * 2 - 1, -1, 1),
    y: clampNodeSliderValue(-(py * 2 - 1), -1, 1),
  };
}

function nodeGraphPhosphillatorBeginCapture(nodeId, smoothingAmount) {
  const state = createNodeGraphPhosphillatorCaptureState();
  state.smoothingAmount = clampNodeSliderValue(nodeGraphFiniteNumber(smoothingAmount), 0, 1);
  // First real point primes the filter (seed on first add).
  state.primed = false;
  nodeGraphPhosphillatorCaptureStates.set(nodeId, state);
  return state;
}

function nodeGraphPhosphillatorAddCapturePoint(nodeId, x, y) {
  const state = nodeGraphPhosphillatorCaptureStates.get(nodeId);
  if (!state) {
    return;
  }
  const rawX = nodeGraphFiniteNumber(x);
  const rawY = nodeGraphFiniteNumber(y);
  let smoothedX = rawX;
  let smoothedY = rawY;
  if (typeof nodeGraphMouseSmoothPoint === "function" && state.mouseSmooth) {
    if (!state.primed && typeof nodeGraphMouseSmoothBegin === "function") {
      nodeGraphMouseSmoothBegin(state.mouseSmooth, state.smoothingAmount ?? 0.5, rawX, rawY);
      state.primed = true;
    }
    const smoothed = nodeGraphMouseSmoothPoint(
      state.mouseSmooth,
      rawX,
      rawY,
      state.smoothingAmount ?? 0.5,
    );
    smoothedX = smoothed.x;
    smoothedY = smoothed.y;
  }
  state.points.push({
    x: clampNodeSliderValue(smoothedX, -1, 1),
    y: clampNodeSliderValue(smoothedY, -1, 1),
  });
}

// Catmull-Rom evaluation for one axis at parameter t in [0,1], given the
// four control values surrounding the segment (p1 -> p2 is the segment).
function nodeGraphPhosphillatorCatmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1)
    + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

// Open-path arclength resample (no last→first segment). Endpoints clamp for
// Catmull-Rom neighbors so the spline stays within the drawn stroke.
function nodeGraphPhosphillatorResampleOpenPath(points, targetCount) {
  const n = points.length;
  if (n < 3) {
    return [];
  }
  const at = (index) => points[Math.max(0, Math.min(n - 1, index))];
  const segmentLengths = [];
  let totalLength = 0;
  for (let i = 0; i < n - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    segmentLengths.push(length);
    totalLength += length;
  }
  if (totalLength <= 0) {
    return [];
  }
  const resampled = [];
  let segmentIndex = 0;
  let segmentStartLength = 0;
  const lastSeg = n - 2;
  for (let k = 0; k < targetCount; k += 1) {
    // Include both endpoints: k=0 → start, k=targetCount-1 → end.
    const targetLength = targetCount <= 1
      ? 0
      : (k / (targetCount - 1)) * totalLength;
    while (
      segmentIndex < lastSeg
      && segmentStartLength + segmentLengths[segmentIndex] < targetLength
    ) {
      segmentStartLength += segmentLengths[segmentIndex];
      segmentIndex += 1;
    }
    const segmentLength = segmentLengths[segmentIndex] || 1e-9;
    const t = clampNodeSliderValue((targetLength - segmentStartLength) / segmentLength, 0, 1);
    const p0 = at(segmentIndex - 1);
    const p1 = at(segmentIndex);
    const p2 = at(segmentIndex + 1);
    const p3 = at(segmentIndex + 2);
    resampled.push({
      x: clampNodeSliderValue(nodeGraphPhosphillatorCatmullRom(p0.x, p1.x, p2.x, p3.x, t), -1, 1),
      y: clampNodeSliderValue(nodeGraphPhosphillatorCatmullRom(p0.y, p1.y, p2.y, p3.y, t), -1, 1),
    });
  }
  return resampled;
}

function nodeGraphPhosphillatorFinishCapture(nodeId) {
  const state = nodeGraphPhosphillatorCaptureStates.get(nodeId);
  nodeGraphPhosphillatorCaptureStates.delete(nodeId);
  if (!state || state.points.length < 3) {
    return;
  }
  const resampled = nodeGraphPhosphillatorResampleOpenPath(state.points, nodeGraphPhosphillatorResampledPointCount);
  if (!resampled.length) {
    return;
  }
  const packedPoints = resampled.map((point) => packNodeGraphPhosphorDrawSample(
    point.x,
    point.y,
    true,
    nodeGraphPhosphillatorDrawIntensity,
  ));
  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  const targetNode = patch.nodes.find((node) => node.id === nodeId);
  if (!targetNode) {
    return;
  }
  targetNode.drawnPath = { points: packedPoints };
  commitNodeGraphPatch(patch, { status: "phosphillator shape drawn" });
}

function nodeGraphPhosphillatorClearDrawnPath(nodeId) {
  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  const targetNode = patch.nodes.find((node) => node.id === nodeId);
  if (!targetNode || !targetNode.drawnPath) {
    return;
  }
  delete targetNode.drawnPath;
  commitNodeGraphPatch(patch, { status: "phosphillator shape cleared" });
}

function bindNodeGraphPhosphillatorInteractions(section, canvas) {
  // Input on the section: the face box is never a hit target.
  section.style.touchAction = "none";
  let pointerId = null;

  section.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== undefined) {
      return;
    }
    pointerId = event.pointerId;
    try {
      section.setPointerCapture?.(pointerId);
    } catch {
      // No active pointer to capture (e.g. synthetic events) — capture is a
      // nicety for drag-outside-canvas continuity, not a correctness need.
    }
    const nodeId = section.dataset.node;
    const node = nodeGraphPatchNode(nodeId);
    nodeGraphPhosphillatorBeginCapture(nodeId, node?.params?.smoothing ?? 0.5);
    const point = nodeGraphPhosphillatorPointerToNormalized(canvas, event.clientX, event.clientY);
    nodeGraphPhosphillatorAddCapturePoint(nodeId, point.x, point.y);
    event.stopPropagation();
  });

  section.addEventListener("pointermove", (event) => {
    if (pointerId === null || event.pointerId !== pointerId) {
      return;
    }
    const point = nodeGraphPhosphillatorPointerToNormalized(canvas, event.clientX, event.clientY);
    nodeGraphPhosphillatorAddCapturePoint(section.dataset.node, point.x, point.y);
    event.stopPropagation();
  });

  const endCapture = (event) => {
    if (pointerId === null || event.pointerId !== pointerId) {
      return;
    }
    try {
      section.releasePointerCapture?.(pointerId);
    } catch {
      // Already released/not captured — safe to ignore.
    }
    pointerId = null;
    nodeGraphPhosphillatorFinishCapture(section.dataset.node);
  };
  section.addEventListener("pointerup", endCapture);
  section.addEventListener("pointercancel", endCapture);

  section.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    nodeGraphPhosphillatorClearDrawnPath(section.dataset.node);
  });
}

function scheduleNodeGraphPhosphillatorFrame(section) {
  if (!section.isConnected) {
    return;
  }
  drawNodeGraphPhosphillatorDrawDisplay(section);
  window.requestAnimationFrame(() => scheduleNodeGraphPhosphillatorFrame(section));
}

function createNodeGraphPhosphillatorDrawDisplay(nodeId, type) {
  const section = document.createElement("section");
  section.className = "node-phosphillator-draw-display";
  section.dataset.node = nodeId;
  section.dataset.nodeType = type;
  section.setAttribute("aria-label", `${nodeGraphNodeDisplayName?.(nodeId) || "Phosphillator"} drawing surface — draw a shape, double-click to clear`);

  const canvas = nodeGraphDisplayCanvasCreate("node-phosphillator-draw-canvas");
  section.append(canvas);
  bindNodeGraphPhosphillatorInteractions(section, canvas);
  window.requestAnimationFrame(() => scheduleNodeGraphPhosphillatorFrame(section));
  return section;
}

function nodeGraphPhosphillatorPointToPixel(point, width, height) {
  return {
    x: ((point.x + 1) / 2) * width,
    y: ((1 - point.y) / 2) * height,
  };
}

const NODE_GRAPH_PHOSPHILLATOR_FACE = Object.freeze({
  background: [2 / 255, 10 / 255, 6 / 255, 1],
  glow: [90 / 255, 1, 150 / 255, 0.4],
  core: [190 / 255, 1, 215 / 255, 0.95],
});

// Open path in face backing px: soft glow under a thin core line.
function drawNodeGraphPhosphillatorGlowPath(batch, pixels, pixelRatio) {
  if (pixels.length < 2) {
    return;
  }
  const flat = new Array(pixels.length * 2);
  for (let i = 0; i < pixels.length; i += 1) {
    flat[i * 2] = pixels[i].x;
    flat[i * 2 + 1] = pixels[i].y;
  }
  const F = NODE_GRAPH_PHOSPHILLATOR_FACE;
  nodeGraphGlLinesPhosphor(batch, flat, 3 * pixelRatio, F.glow);
  nodeGraphGlLinesPolyline(batch, flat, 0.7 * pixelRatio, 1, F.core);
}

function drawNodeGraphPhosphillatorDrawDisplay(section) {
  const nodeId = section?.dataset?.node || "";
  const node = nodeGraphPatchNode(nodeId);
  const canvas = section?.querySelector?.(".node-phosphillator-draw-canvas");
  if (!node || !canvas) {
    return;
  }
  const metrics = nodeGraphSizeDisplayCanvas(section, canvas);
  if (!metrics) {
    return;
  }
  const { cssHeight, cssWidth, pixelRatio, width, height } = metrics;
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, NODE_GRAPH_PHOSPHILLATOR_FACE.background)
    : null;
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "Phosphillator: shared GL unavailable");
    return;
  }

  const capture = nodeGraphPhosphillatorCaptureStates.get(nodeId);
  const drawnPoints = node.drawnPath?.points;
  if (capture && capture.points.length >= 2) {
    const pixels = capture.points.map((point) => nodeGraphPhosphillatorPointToPixel(point, width, height));
    drawNodeGraphPhosphillatorGlowPath(batch, pixels, pixelRatio);
  } else if (Array.isArray(drawnPoints) && drawnPoints.length >= 2) {
    const pixels = drawnPoints.map((packed) => {
      const unpacked = unpackNodeGraphPhosphorDrawSample(packed);
      return nodeGraphPhosphillatorPointToPixel(unpacked, width, height);
    });
    // Open path — no last→first stroke; playback reverses instead of jumping.
    drawNodeGraphPhosphillatorGlowPath(batch, pixels, pixelRatio);
  } else {
    // Placeholder: Sample Player default ink (font size, line color).
    const settings = typeof normalizeNodeGraphSampleWaveformSettings === "function"
      ? normalizeNodeGraphSampleWaveformSettings({})
      : undefined;
    const fontUnit = Number.isFinite(Number(settings?.fontSize))
      ? Number(settings.fontSize)
      : nodeGraphSampleWaveformDefaultSettings.fontSize;
    const px = Math.max(1, Math.round(faceInkPx(clampAuthoredInkPx(fontUnit, 11), faceMinSide(cssWidth, cssHeight))));
    nodeGraphGlLinesText(batch, "Draw a shape — dblclick to clear", Math.round(width / 2), Math.round(height / 2), {
      px,
      weight: 600,
      align: "center",
      baseline: "middle",
      rgba: nodeGraphGlLinesCss(nodeGraphSampleWaveformLineColor(settings, 57, 0.55)),
    });
  }
  if (!nodeGraphGlLinesEnd(batch, "alpha")) {
    nodeGraphGlLinesFillBlack(canvas);
  }
}

// Playback: open path + Jerobeam trisaw path index. Drawn points decode once
// per patch change (cache keyed on the points array reference) into flat X/Y
// arrays; each sample advances a 0..1 phase accumulator (pitch → freq)
// and maps phase through trisaw(sharpness) onto the open path [0 .. n-1].

const nodeGraphPhosphillatorDecodedPathCache = new Map();

function nodeGraphPhosphillatorDecodedPath(nodeId, node) {
  const points = node?.drawnPath?.points;
  if (!Array.isArray(points) || points.length < 2) {
    nodeGraphPhosphillatorDecodedPathCache.delete(nodeId);
    return null;
  }
  const cached = nodeGraphPhosphillatorDecodedPathCache.get(nodeId);
  if (cached && cached.pointsRef === points) {
    return cached;
  }
  const decodedX = new Float32Array(points.length);
  const decodedY = new Float32Array(points.length);
  for (let i = 0; i < points.length; i += 1) {
    const unpacked = unpackNodeGraphPhosphorDrawSample(points[i]);
    decodedX[i] = unpacked.x;
    decodedY[i] = unpacked.y;
  }
  const decoded = { count: points.length, decodedX, decodedY, pointsRef: points };
  nodeGraphPhosphillatorDecodedPathCache.set(nodeId, decoded);
  return decoded;
}

// Index the open path at pathPos ∈ [0,1] (0 = first point, 1 = last). No wrap.
function nodeGraphPhosphillatorPathSample(decoded, pathPos) {
  const n = decoded.count;
  if (n < 2) {
    return { x: decoded.decodedX[0] || 0, y: decoded.decodedY[0] || 0 };
  }
  const pos = Math.min(1, Math.max(0, nodeGraphFiniteNumber(pathPos)));
  const index = pos * (n - 1);
  const i0 = Math.min(n - 2, Math.floor(index));
  const i1 = i0 + 1;
  const t = index - i0;
  return {
    x: decoded.decodedX[i0] + (decoded.decodedX[i1] - decoded.decodedX[i0]) * t,
    y: decoded.decodedY[i0] + (decoded.decodedY[i1] - decoded.decodedY[i0]) * t,
  };
}

// phase ∈ [0,1) oscillator phase; sharpness ∈ [0,1] trisaw warp (stdlib).
function nodeGraphPhosphillatorLoopSample(decoded, phase, sharpness) {
  const pathPos = nodeGraphTrisaw(phase, sharpness);
  return nodeGraphPhosphillatorPathSample(decoded, pathPos);
}

function createNodeGraphPhosphillatorPlaybackState() {
  return { lastReset: false, phase: 0 };
}

// cvInput: pitch via nodeGraphPitchedFrequency / nodeGraphAdvancePhase01.
function nodeGraphPhosphillatorAdvancePhase(state, cvInput, frequency, reset, sampleRate) {
  return nodeGraphAdvancePitchedPhase01(state, frequency, cvInput, sampleRate, reset);
}

function nodeGraphPhosphillatorPlaybackSample(state, node, nodeId, cvInput, frequency, phaseOffset, reset, sampleRate, sharpness) {
  const phase = nodeGraphPhosphillatorAdvancePhase(state, cvInput, frequency, reset, sampleRate);
  const decoded = nodeGraphPhosphillatorDecodedPath(nodeId, node);
  if (!decoded) {
    return { X: 0, Y: 0 };
  }
  const effectivePhase = nodeGraphWrap01((nodeGraphFiniteNumber(phase)) + (nodeGraphFiniteNumber(phaseOffset)));
  const sharp = Number.isFinite(Number(sharpness)) ? Number(sharpness) : 0.5;
  const point = nodeGraphPhosphillatorLoopSample(decoded, effectivePhase, sharp);
  return { X: point.x, Y: point.y };
}
