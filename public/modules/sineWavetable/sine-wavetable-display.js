// SinCos4 face — unit circle + mode phase rays (1…4).
// Geometry is authored in 0…1 face space (centered square), then scaled to the
// canvas so F-fullscreen / resize keep proportions. Position markers are round
// dots (never square caps / stretched buffer pixels).

function createNodeGraphSinCos4Display(nodeId, type = "sineWavetable") {
  const id = nodeId && typeof nodeId === "object"
    ? String(nodeId.dataset?.node || nodeId.id || "")
    : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-sincos4-display node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "sineWavetable");
  section.dataset.parameterVisual = "true";
  section.dataset.lightSource = "screen";
  section.dataset.lightStrength = "0.85";
  const canvas = nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-sincos4-canvas");
  canvas.dataset.lightSource = "screen";
  canvas.dataset.lightStrength = "0.85";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  section.append(canvas);
  section._sinCos4Canvas = canvas;
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `sinCos4:${el.dataset?.node || ""}`,
    forceKey: "_sinCos4ForceDraw",
    rafKey: "_sinCos4PlayheadRaf",
    paint: drawNodeGraphSinCos4Display,
    onResize: (el) => {
      el._sinCos4LaidOut = false;
      el._sinCos4ForceDraw = true;
    },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      drawNodeGraphSinCos4Display(section);
      section._startFaceLoop?.();
    });
  });
  return section;
}

function nodeGraphSinCos4LiveParam(node, key, fallback = 0) {
  if (typeof nodeGraphFilterCurveLiveParam === "function") {
    return nodeGraphFilterCurveLiveParam(node, key, fallback);
  }
  const n = Number(node?.params?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

/** Mode → relative phase offsets in cycles (A at 0). */
function nodeGraphSinCos4PhaseOffsets(mode) {
  const m = Math.max(0, Math.min(5, Math.round(nodeGraphFiniteNumber(mode))));
  if (m === 0) return [0];
  if (m === 1) return [0.25];
  if (m === 2) return [0, 0.25];
  if (m === 3) return [0, 0.5];
  if (m === 4) return [0, 1 / 3, 2 / 3];
  return [0, 0.25, 0.5, 0.75];
}

const NODE_GRAPH_SINCOS4_COLORS = Object.freeze([
  "rgb(255, 90, 90)",
  "rgb(90, 220, 120)",
  "rgb(90, 160, 255)",
  "rgb(240, 210, 120)",
]);

/** Face look in 0…1 of the centered square (F-safe). */
function nodeGraphSinCos4FaceNorm(node) {
  const td = node?.traceDisplaySettings && typeof node.traceDisplaySettings === "object"
    ? node.traceDisplaySettings
    : {};
  const clamp01 = (v, fb) => globalThis.SoemMath.clamp01(v, fb);
  // dot1Size 0…1 → tip radius in unit square (default ~2.2% of side).
  const tip = 0.01 + clamp01(td.dot1Size, 0.08) * 0.04;
  return {
    radius: 0.38,
    stroke: 0.012,
    tip,
    hub: tip * 0.7,
    pixelDensity: clamp01(td.pixelDensity, 1) || 1,
  };
}

function nodeGraphSinCos4Wrap01(v) {
  const n = nodeGraphFiniteNumber(v);
  return n - Math.floor(n);
}

function nodeGraphSinCos4ReadPhase(nodeId, node, section) {
  if (typeof nodeGraphModuleScopeLatestOutputValue === "function") {
    const live = Number(nodeGraphModuleScopeLatestOutputValue(nodeId, "__Phase", Number.NaN));
    if (Number.isFinite(live)) {
      return nodeGraphSinCos4Wrap01(live);
    }
  }
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  const freq = nodeGraphFiniteNumber(nodeGraphSinCos4LiveParam(node, "freq", 100));
  const offset = nodeGraphFiniteNumber(nodeGraphSinCos4LiveParam(node, "phase", 0));
  const speed = Number(typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.live?.speedMultiplier : 1);
  const mul = Number.isFinite(speed) ? speed : 1;
  if (section && Number.isFinite(section._sinCos4Clock)) {
    const dt = Math.max(0, Math.min(0.25, now - section._sinCos4Clock));
    let next = (nodeGraphFiniteNumber(section._sinCos4Phase)) + freq * dt * mul;
    next = nodeGraphSinCos4Wrap01(next);
    section._sinCos4Phase = next;
    section._sinCos4Clock = now;
    return nodeGraphSinCos4Wrap01(next + offset);
  }
  if (section) {
    section._sinCos4Clock = now;
    section._sinCos4Phase = 0;
  }
  return nodeGraphSinCos4Wrap01(offset);
}

function drawNodeGraphSinCos4Display(section) {
  try {
    drawNodeGraphSinCos4DisplayInner(section);
  } catch (error) {
    console.error("[sincos4] draw failed", error?.message || error);
    if (section) {
      section._sinCos4ForceDraw = true;
      section._sinCos4LaidOut = false;
    }
  }
}

// Round position dot (shared smoothstep capsule of zero length).
function drawNodeGraphSinCos4FillDot(batch, x, y, radius, feather, rgba) {
  nodeGraphGlLinesDot(batch, x, y, radius, feather, rgba);
}

function drawNodeGraphSinCos4DisplayInner(section) {
  if (!section || section.isConnected === false) {
    return;
  }
  const nodeId = section.dataset?.node
    || section.closest?.(".dsp-node")?.dataset?.node
    || "";
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const canvas = section._sinCos4Canvas
    || section.querySelector?.(".node-sincos4-canvas")
    || section.querySelector?.("canvas");
  if (!node || !canvas) {
    return;
  }
  section._sinCos4Canvas = canvas;

  // Viewport-asleep faces are display:none: nothing to paint, and measuring
  // them would force a layout every frame (zoom gesture reads).
  if (section.closest?.(".viewport-asleep") && !section.classList.contains("node-screen-solo-face")) {
    return;
  }
  const look = nodeGraphSinCos4FaceNorm(node);
  // Prefer the live layout box; in F solo fill, fall back to the stage cell so
  // we never paint into a leftover short filter-curve band.
  let rawW = nodeGraphFiniteNumber(section.clientWidth);
  let rawH = nodeGraphFiniteNumber(section.clientHeight);
  if (
    (rawW < 8 || rawH < 8 || section.classList.contains("node-screen-solo-face"))
    && typeof document !== "undefined"
  ) {
    const stage = section.closest?.("#nodeScreenSoloStage");
    if (stage) {
      const cols = Math.max(1, nodeGraphFiniteNumber(stage.style.getPropertyValue("--node-screen-solo-cols"), 1));
      const rows = Math.max(1, nodeGraphFiniteNumber(stage.style.getPropertyValue("--node-screen-solo-rows"), 1));
      const cellW = Math.floor((stage.clientWidth || window.innerWidth || 0) / cols);
      const cellH = Math.floor((stage.clientHeight || window.innerHeight || 0) / rows);
      if (section.getAttribute("data-solo-fit") === "contain") {
        const iw = parseFloat(section.style.getPropertyValue("--node-screen-solo-item-w")) || 0;
        const ih = parseFloat(section.style.getPropertyValue("--node-screen-solo-item-h")) || 0;
        if (iw > 0 && ih > 0) {
          rawW = Math.max(rawW, iw);
          rawH = Math.max(rawH, ih);
        } else {
          rawW = Math.max(rawW, Math.min(cellW, cellH));
          rawH = Math.max(rawH, Math.min(cellW, cellH));
        }
      } else {
        rawW = Math.max(rawW, cellW);
        rawH = Math.max(rawH, cellH);
      }
    }
  }
  if (rawW < 8 || rawH < 8) {
    return;
  }
  const soloFace = section.classList.contains("node-screen-solo-face");
  // In F solo, size from the cell/square we resolved above — not the short
  // filter-curve band the shared sizing would still see mid-layout.
  const m = soloFace
    ? (typeof nodeGraphDisplayCanvasSizeCss === "function" ? nodeGraphDisplayCanvasSizeCss(canvas, rawW, rawH, look.pixelDensity) : null)
    : (typeof nodeGraphDisplayCanvasSize === "function" ? nodeGraphDisplayCanvasSize(section, canvas, { pixelDensity: look.pixelDensity }) : null);
  if (!m) {
    return;
  }
  const pixelRatio = Math.max(1e-6, nodeGraphFiniteNumber(m.pixelRatio, 1));
  const cssW = Math.max(1, m.width / pixelRatio);
  const cssH = Math.max(1, m.height / pixelRatio);

  const mode = Math.max(0, Math.min(5, Math.round(nodeGraphSinCos4LiveParam(node, "mode", 2))));
  const offsets = nodeGraphSinCos4PhaseOffsets(mode);
  const phase = nodeGraphSinCos4ReadPhase(nodeId, node, section);

  // CSS-pixel plate, then a centered unit square (0…1) so F scales cleanly.
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, [5 / 255, 6 / 255, 10 / 255, 1], { scale: pixelRatio })
    : null;
  if (!batch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    section._sinCos4ForceDraw = false;
    return;
  }
  const side = Math.min(cssW, cssH);
  const ox = (cssW - side) * 0.5;
  const oy = (cssH - side) * 0.5;
  const X = (u) => ox + u * side;
  const Y = (v) => oy + v * side;
  const feather = 0.7;

  const cx = 0.5;
  const cy = 0.5;
  const radius = look.radius;
  const stroke = look.stroke;
  const tipR = look.tip;
  const hubR = look.hub;
  const halfOf = (unitW) => Math.max(0, unitW * side * 0.5 - feather * 0.5);

  const ring = [];
  const n = 96;
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    ring.push(X(cx + Math.cos(a) * radius), Y(cy - Math.sin(a) * radius));
  }
  nodeGraphGlLinesPolyline(batch, ring, halfOf(stroke), feather, [160 / 255, 190 / 255, 210 / 255, 0.35]);

  // Rays; position shown by round dots.
  for (let i = 0; i < offsets.length; i += 1) {
    const ang = (phase + offsets[i]) * Math.PI * 2;
    const x = cx + Math.cos(ang) * radius;
    const y = cy - Math.sin(ang) * radius;
    const color = nodeGraphGlLinesCss(NODE_GRAPH_SINCOS4_COLORS[i] || NODE_GRAPH_SINCOS4_COLORS[3]);
    nodeGraphGlLinesSegment(batch, X(cx), Y(cy), X(x), Y(y), halfOf(stroke * (i === 0 ? 1.35 : 1)), feather, color);
    drawNodeGraphSinCos4FillDot(batch, X(x), Y(y), Math.max(0, tipR * (i === 0 ? 1.15 : 1) * side - feather * 0.5), feather, color);
  }
  drawNodeGraphSinCos4FillDot(batch, X(cx), Y(cy), Math.max(0, hubR * side - feather * 0.5), feather, [220 / 255, 230 / 255, 240 / 255, 0.9]);
  if (!nodeGraphGlLinesEnd(batch) && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);

  section._sinCos4LaidOut = true;
  section._sinCos4ForceDraw = false;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.sinCos4Face = () => {};
}
