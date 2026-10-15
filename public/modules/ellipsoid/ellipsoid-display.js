// RoundShape face — cheap vector orbit (filter-curve family).
// Stroke samples the same math as the signal. Cursor is a vector circle
// on that stroke.

function createNodeGraphRoundShapeDisplay(nodeId, type = "ellipsoid") {
  const id = nodeId && typeof nodeId === "object"
    ? String(nodeId.dataset?.node || nodeId.id || "")
    : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-round-shape-display node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "ellipsoid");
  section.dataset.parameterVisual = "true";
  section.dataset.lightSource = "screen";
  section.dataset.lightStrength = "0.66";
  const canvas = nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-round-shape-canvas");
  canvas.dataset.lightSource = "screen";
  canvas.dataset.lightStrength = "0.66";
  section.append(canvas);
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `roundShape:${el.dataset?.node || ""}`,
    forceKey: "_roundShapeForceDraw",
    rafKey: "_roundShapePlayheadRaf",
    paint: drawNodeGraphRoundShapeDisplay,
    onResize: (el) => {
      if (typeof syncFaceMetrics === "function") syncFaceMetrics(el);
      el._roundShapeLaidOut = false;
    },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      drawNodeGraphRoundShapeDisplay(section);
      section._startFaceLoop?.();
    });
  });
  return section;
}

function nodeGraphRoundShapeLiveParam(node, key, fallback = 0) {
  if (typeof nodeGraphFilterCurveLiveParam === "function") {
    return nodeGraphFilterCurveLiveParam(node, key, fallback);
  }
  const n = Number(node?.params?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

function nodeGraphRoundShapeReadScopePort(nodeId, port) {
  if (typeof nodeGraphModuleScopeLatestOutputValue !== "function") {
    return Number.NaN;
  }
  const value = Number(nodeGraphModuleScopeLatestOutputValue(nodeId, port, Number.NaN));
  return Number.isFinite(value) ? value : Number.NaN;
}

function nodeGraphRoundShapeLivePlaying() {
  // Same transport gate as scopePaintIsDrawingLive (speed>0 + worklet up).
  if (typeof scopePaintIsDrawingLive === "function") {
    return scopePaintIsDrawingLive();
  }
  if (typeof nodeGraphMvp === "undefined" || !nodeGraphMvp?.live?.node) {
    return false;
  }
  const speed = Number(nodeGraphMvp.live.speedMultiplier);
  return !Number.isFinite(speed) || speed > 0;
}

/** Unit-orbit cursor from live oscillator phase (same math as the stroke). */
function nodeGraphRoundShapeLiveCursor(nodeId, node, section) {
  const shape = Math.max(0, Math.min(1, nodeGraphFiniteNumber(nodeGraphRoundShapeLiveParam(node, "morph", 0))));
  let phase = nodeGraphRoundShapeReadScopePort(nodeId, "__Phase");
  if (!Number.isFinite(phase) && typeof nodeGraphMvp !== "undefined") {
    const stored = nodeGraphMvp?.live?.runtime?.phases?.get?.(nodeId);
    if (Number.isFinite(Number(stored))) {
      const offset = nodeGraphFiniteNumber(nodeGraphRoundShapeLiveParam(node, "phase", 0));
      phase = Number(stored) + offset;
    }
  }
  if (!Number.isFinite(phase) && nodeGraphRoundShapeLivePlaying()) {
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    const freq = nodeGraphFiniteNumber(nodeGraphRoundShapeLiveParam(node, "frequency", 1));
    const offset = nodeGraphFiniteNumber(nodeGraphRoundShapeLiveParam(node, "phase", 0));
    const speed = Number(nodeGraphMvp?.live?.speedMultiplier);
    const mul = Number.isFinite(speed) ? speed : 1;
    if (section && Number.isFinite(section._roundShapeClock)) {
      const dt = Math.max(0, Math.min(0.25, now - section._roundShapeClock));
      let next = (nodeGraphFiniteNumber(section._roundShapePhase)) + freq * dt * mul;
      next -= Math.floor(next);
      section._roundShapePhase = next;
      section._roundShapeClock = now;
      phase = next;
    } else {
      if (section) {
        section._roundShapeClock = now;
        section._roundShapePhase = offset;
      }
      phase = offset;
    }
  }
  if (!Number.isFinite(phase)) {
    return null;
  }
  phase -= Math.floor(phase);
  return nodeGraphRoundShapeEllipsoidPoint(phase, shape);
}

function nodeGraphRoundShapeFaceLook(node) {
  if (typeof normalizeNodeGraphRoundShapeFaceSettings === "function") {
    return normalizeNodeGraphRoundShapeFaceSettings(node?.traceDisplaySettings);
  }
  const face = node?.traceDisplaySettings && typeof node.traceDisplaySettings === "object"
    ? node.traceDisplaySettings
    : {};
  return {
    background: String(face.background || face.backgroundColor || "#020609"),
    backgroundPaint: String(face.backgroundPaint || face.background || face.backgroundColor || "#020609"),
    strokeColor: String(face.strokeColor || face.dot1Color || face.color || "rgba(120, 220, 200, 0.92)"),
    strokePaint: String(face.strokePaint || face.strokeColor || "rgba(120, 220, 200, 0.92)"),
    dotColor: String(face.dotColor || "#ffffff"),
    dotPaint: String(face.dotPaint || face.dotColor || "#ffffff"),
    lineThickness: Math.max(0.25, nodeGraphFiniteNumber(face.lineThickness, 2)),
    dotThickness: Math.max(0.25, nodeGraphFiniteNumber(face.dotThickness, 5)),
    lineBlur: Math.max(0, nodeGraphFiniteNumber(face.lineBlur)),
    pixelDensity: Number.isFinite(Number(face.pixelDensity)) ? Number(face.pixelDensity) : 1,
  };
}

function drawNodeGraphRoundShapeDisplay(section) {
  try {
    drawNodeGraphRoundShapeDisplayInner(section);
  } catch (error) {
    const detail = error && typeof error === "object"
      ? (error.message || error.name || String(error))
      : String(error);
    console.error("[round-shape] draw failed", detail, error);
    if (section) {
      section._roundShapeForceDraw = true;
      section._roundShapeLaidOut = false;
    }
  }
}

function nodeGraphRoundShapeEllipsoidOscPoint(phase01, node) {
  const phase = (nodeGraphFiniteNumber(phase01)) * Math.PI * 2;
  const params = {
    amplitude: 1,
    antialias: nodeGraphRoundShapeLiveParam(node, "antialias", 1),
    frequencyHz: 0,
    offset: nodeGraphRoundShapeLiveParam(node, "offset", 0),
    sampleRate: 44100,
    scale: nodeGraphRoundShapeLiveParam(node, "scale", 1),
    shape: nodeGraphRoundShapeLiveParam(node, "shape", 0),
  };
  if (typeof nodeGraphEllipsoidVectorSample === "function") {
    const v = nodeGraphEllipsoidVectorSample(phase, params);
    const x = Number(v.X);
    const y = Number(v.Y);
    return {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
    };
  }
  return { x: Math.cos(phase), y: Math.sin(phase) };
}

function nodeGraphRoundShapeEllipsoidPoint(phase, shape) {
  if (typeof nodeGraphEllipsoidSineToSquareVector === "function") {
    const v = nodeGraphEllipsoidSineToSquareVector(phase, {
      amplitude: 1,
      shape,
      frequencyHz: 0,
      sampleRate: 44100,
    });
    const x = Number(v["Bi X"]);
    const y = Number(v["Bi Y"]);
    return {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
    };
  }
  const ang = phase * Math.PI * 2;
  return { x: Math.cos(ang), y: Math.sin(ang) };
}

function drawNodeGraphRoundShapeDisplayInner(section) {
  const nodeId = section?.dataset?.node
    || section?.closest?.(".dsp-node")?.dataset?.node
    || "";
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const canvas = section?.querySelector?.(".node-round-shape-canvas")
    || section?.querySelector?.("canvas");
  if (!node || !canvas) {
    return;
  }
  const isEllipsoidOsc = node.type === "ellipsoidOsc";
  let shape = Number(nodeGraphRoundShapeLiveParam(node, "morph", 0));
  shape = Math.max(0, Math.min(1, Number.isFinite(shape) ? shape : 0));
  const look = nodeGraphRoundShapeFaceLook(node);
  const strokeColor = look.strokePaint || look.strokeColor;
  const plateBg = look.backgroundPaint || look.background;
  const dotColor = look.dotPaint || look.dotColor;
  const strokeW = look.lineThickness;
  const dotW = Number.isFinite(Number(look.dotThickness)) ? Number(look.dotThickness) : 5;
  const lineBlur = look.lineBlur;
  const pixelDensity = look.pixelDensity;
  const faceMetrics = typeof ensureFaceMetrics === "function"
    ? ensureFaceMetrics(section, { observe: true })
    : null;
  const rawW = faceMetrics
    ? faceMetrics.cssW
    : nodeGraphFiniteNumber(section.clientWidth || section.offsetWidth);
  const rawH = faceMetrics
    ? faceMetrics.cssH
    : nodeGraphFiniteNumber(section.clientHeight || section.offsetHeight);
  const signature = [
    isEllipsoidOsc ? "ellipsoidOsc" : "orbit",
    shape.toFixed(4),
    isEllipsoidOsc ? nodeGraphRoundShapeLiveParam(node, "offset", 0).toFixed(4) : "",
    isEllipsoidOsc ? nodeGraphRoundShapeLiveParam(node, "shape", 0).toFixed(4) : "",
    isEllipsoidOsc ? nodeGraphRoundShapeLiveParam(node, "scale", 1).toFixed(4) : "",
    isEllipsoidOsc ? nodeGraphRoundShapeLiveParam(node, "antialias", 1).toFixed(0) : "",
    isEllipsoidOsc ? nodeGraphRoundShapeLiveParam(node, "amplitude", 1).toFixed(4) : "",
    strokeColor,
    plateBg,
    dotColor,
    strokeW.toFixed(2),
    dotW.toFixed(2),
    lineBlur.toFixed(2),
    pixelDensity.toFixed(3),
    Number(look.lineHue || 0).toFixed(1),
    Number(look.lineBrightness || 0).toFixed(3),
    Number(look.dotHue || 0).toFixed(1),
    Number(look.dotBrightness || 0).toFixed(3),
    Number(look.backgroundHue || 0).toFixed(1),
    Number(look.backgroundBrightness || 0).toFixed(3),
    `${Math.round(rawW)}x${Math.round(rawH)}`,
  ].join("|");
  const livePlaying = nodeGraphRoundShapeLivePlaying();
  if (
    !livePlaying
    && section._roundShapeSignature === signature
    && !section._roundShapeForceDraw
    && section._roundShapeLaidOut === true
  ) {
    return;
  }
  if (rawW < 8 || rawH < 8) {
    section._roundShapeLaidOut = false;
    section._roundShapeForceDraw = true;
    if (!section._roundShapeRetryFrame) {
      section._roundShapeRetryFrame = requestAnimationFrame(() => {
        section._roundShapeRetryFrame = 0;
        drawNodeGraphRoundShapeDisplay(section);
      });
    }
    return;
  }

  // Shared GL presenter (cycle-line-gl.js on the shared WebGL2 device): the
  // orbit polyline is tessellated only when the look/shape signature or the
  // backing size changes; per frame only the phase dot is rebuilt.
  const metrics = typeof nodeGraphCycleLineGlMetrics === "function"
    ? nodeGraphCycleLineGlMetrics(section, canvas, pixelDensity)
    : null;
  if (!metrics) {
    return;
  }
  const pixelRatio = metrics.pixelRatio || 1;
  // Drawable CSS box (buffer / transform), not section.client* — the
  // backing store can be up to ~1px short, which eats the +X square side.
  const drawW = Math.max(1, canvas.width / pixelRatio);
  const drawH = Math.max(1, canvas.height / pixelRatio);
  if (!(drawW >= 8) || !(drawH >= 8)) {
    return;
  }
  const glKey = `${signature}|${canvas.width}x${canvas.height}`;
  // Also rebuild when the presenter state is fresh (context restored).
  const orbitDirty = section._roundShapeOrbitSig !== glKey || section._roundShapeForceDraw
    || canvas.__cycleLineGl?.waveKey !== glKey;
  section._roundShapeSignature = signature;
  section._roundShapeForceDraw = false;
  section._roundShapeLaidOut = true;

  const samples = 256;
  const strokeInset = strokeW * 0.5 + 1 / Math.max(pixelRatio, 1);
  const pad = Math.max(6, Math.min(drawW, drawH) * 0.08) + strokeInset;
  const cx = drawW * 0.5;
  const cy = drawH * 0.5;
  const half = Math.max(4, Math.min(drawW, drawH) * 0.5 - pad);
  const viewScale = half;

  let lines = null;
  if (orbitDirty) {
    const points = [];
    if (isEllipsoidOsc || typeof nodeGraphEllipsoidSineToSquareVector === "function") {
      // Phase 0/1 is the mid-point of the +X side at shape=1. Starting
      // and ending there drops that whole side (open path + clip). Walk
      // from just after the seam and close so the right edge is a join.
      const eps = 0.5 / samples;
      for (let i = 0; i < samples; i += 1) {
        let phase = i / samples + eps;
        phase -= Math.floor(phase);
        const pt = isEllipsoidOsc
          ? nodeGraphRoundShapeEllipsoidOscPoint(phase, node)
          : nodeGraphRoundShapeEllipsoidPoint(phase, shape);
        points.push({ x: cx + pt.x * viewScale, y: cy - pt.y * viewScale });
      }
    } else {
      for (let i = 0; i < samples; i += 1) {
        const a = (i / samples) * Math.PI * 2;
        points.push({ x: cx + Math.cos(a) * half * 0.85, y: cy + Math.sin(a) * half * 0.85 });
      }
    }
    if (points.length) points.push(points[0]);
    lines = [{ points, color: strokeColor, width: strokeW, blur: lineBlur }];
    section._roundShapeOrbitSig = glKey;
  }

  // Cursor: worklet live uses scope Bi X / Bi Y (no main-thread phases Map).
  let px = null;
  let py = null;
  if (isEllipsoidOsc) {
    let phase = nodeGraphRoundShapeReadScopePort(nodeId, "__Phase");
    if (!Number.isFinite(phase) && typeof nodeGraphMvp !== "undefined") {
      const stored = nodeGraphMvp?.live?.runtime?.phases?.get?.(nodeId);
      if (Number.isFinite(Number(stored))) {
        const offset = nodeGraphFiniteNumber(nodeGraphRoundShapeLiveParam(node, "phase", 0));
        phase = Number(stored) + offset;
      }
    }
    if (!Number.isFinite(phase) && nodeGraphRoundShapeLivePlaying()) {
      const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
      const freq = nodeGraphFiniteNumber(nodeGraphRoundShapeLiveParam(node, "frequency", 100));
      const offset = nodeGraphFiniteNumber(nodeGraphRoundShapeLiveParam(node, "phase", 0));
      const speed = Number(nodeGraphMvp?.live?.speedMultiplier);
      const mul = Number.isFinite(speed) ? speed : 1;
      if (Number.isFinite(section._roundShapeClock)) {
        const dt = Math.max(0, Math.min(0.25, now - section._roundShapeClock));
        let next = (nodeGraphFiniteNumber(section._roundShapePhase)) + freq * dt * mul;
        next -= Math.floor(next);
        section._roundShapePhase = next;
        section._roundShapeClock = now;
        phase = next;
      } else {
        section._roundShapeClock = now;
        section._roundShapePhase = offset;
        phase = offset;
      }
    }
    const pt = nodeGraphRoundShapeEllipsoidOscPoint(
      Number.isFinite(phase) ? phase : 0,
      node,
    );
    px = cx + pt.x * viewScale;
    py = cy - pt.y * viewScale;
  } else {
    const cursor = nodeGraphRoundShapeLiveCursor(nodeId, node, section);
    if (cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) {
      px = cx + cursor.x * viewScale;
      py = cy - cursor.y * viewScale;
    }
  }
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    const start = nodeGraphRoundShapeEllipsoidPoint(0, shape);
    px = cx + start.x * viewScale;
    py = cy - start.y * viewScale;
  }
  const dot = section._roundShapeGlDot || (section._roundShapeGlDot = { x: 0, y: 0, color: "", radius: 0.5 });
  const dots = section._roundShapeGlDots || (section._roundShapeGlDots = [dot]);
  dot.x = px;
  dot.y = py;
  dot.color = dotColor;
  dot.radius = Math.max(0.5, dotW * 0.5);
  nodeGraphCycleLineGlPresent(canvas, {
    cssWidth: drawW,
    cssHeight: drawH,
    background: plateBg,
    waveKey: signature,
    lines: lines || [],
    dots: Number.isFinite(px) && Number.isFinite(py) ? dots : [],
  });
}

function drawNodeGraphRoundShapeDisplays() {
  document.querySelectorAll(".node-round-shape-display").forEach(drawNodeGraphRoundShapeDisplay);
}
