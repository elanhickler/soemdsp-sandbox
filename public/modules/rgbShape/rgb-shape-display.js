// Shape face renderer (displayType rgbShapeFace): gradient fill + silhouette.

const nodeGraphRgbShapeSettingsDefaults = Object.freeze({
  background: "#000000",
  gradientStops: Object.freeze([
    Object.freeze({ t: 0, color: "#000000" }),
    Object.freeze({ t: 0.35, color: "#1a4a88" }),
    Object.freeze({ t: 0.7, color: "#3ecf8e" }),
    Object.freeze({ t: 1, color: "#f0f4ff" }),
  ]),
});

const RGB_SHAPE_GL_WHITE = Object.freeze([1, 1, 1, 1]);

function normalizeNodeGraphRgbShapeSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const defaults = nodeGraphRgbShapeSettingsDefaults;
  const gradientStops = typeof nodeGraphPhosphorGradientStopsFromSettings === "function"
    ? nodeGraphPhosphorGradientStopsFromSettings(source, defaults.gradientStops[defaults.gradientStops.length - 1].color)
    : (Array.isArray(source.gradientStops) && source.gradientStops.length >= 2
      ? source.gradientStops
      : defaults.gradientStops.map((s) => ({ t: s.t, color: s.color })));
  const background = typeof normalizeNodeGraphTraceDisplayColor === "function"
    ? normalizeNodeGraphTraceDisplayColor(source.background ?? source.backgroundColor, defaults.background)
    : String(source.background || defaults.background);
  return {
    background,
    gradientStops,
  };
}

function nodeGraphRgbShapeSettingsForNode(node) {
  if (!node) {
    return normalizeNodeGraphRgbShapeSettings();
  }
  return normalizeNodeGraphRgbShapeSettings(node.traceDisplaySettings);
}

function nodeGraphRgbShapeCanvasForSlot(slot) {
  const face = slot?.scopeElement;
  if (!face) {
    return null;
  }
  return face.querySelector?.(":scope > .node-rgb-shape-canvas")
    || face.querySelector?.(".node-rgb-shape-canvas")
    || null;
}

function nodeGraphRgbShapeReadParam(nodeId, key, fallback) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  // Same face-param path as RoundShape / BasicShape (patch + DOM). Do NOT call
  // readNodeGraphLiveEffectiveParam from paint — it needs a live runtime and
  // throws when smoothers is missing (black face + console spam).
  if (typeof nodeGraphFilterCurveLiveParam === "function" && node) {
    const live = Number(nodeGraphFilterCurveLiveParam(node, key, Number.NaN));
    if (Number.isFinite(live)) {
      return live;
    }
  }
  if (typeof nodeGraphReadNodeNumber === "function") {
    const n = Number(nodeGraphReadNodeNumber(nodeId, key));
    if (Number.isFinite(n)) {
      return n;
    }
  }
  const raw = Number(node?.params?.[key]);
  if (Number.isFinite(raw)) {
    return raw;
  }
  // Migrate old "position" → brightness.
  if (key === "brightness") {
    const legacy = Number(node?.params?.position);
    if (Number.isFinite(legacy)) {
      return legacy;
    }
  }
  return fallback;
}

function paintNodeGraphRgbShapeFace(canvas, face, nodeId, buffer = null) {
  if (!canvas || !face || !nodeId) {
    return false;
  }
  // Shared sizing (css x dpr, never zoom); drawing is WebGL2 via gl-line-renderer.
  const m = typeof nodeGraphDisplayCanvasSize === "function" ? nodeGraphDisplayCanvasSize(face, canvas) : null;
  if (!m || !(m.width > 0) || !(m.height > 0)) {
    return false;
  }
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const settings = nodeGraphRgbShapeSettingsForNode(patchNode);
  const w = m.width;
  const h = m.height;
  const bg = settings.background || "#000000";
  // publishNodeId "": the rgba out keeps going through nodeGraphPicturePublishCanvas
  // in drawNodeGraphRgbShapeFaceItem (unchanged), not the batch's own export.
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, nodeGraphGlLinesCss(bg), { publishNodeId: "" })
    : null;
  if (!batch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    return false;
  }

  let brightness = nodeGraphRgbShapeReadParam(nodeId, "brightness", 0.5);
  if (buffer?.length && !buffer.nodeGraphScopeXy) {
    const sample = typeof nodeGraphOscilloscopeLatestSample === "function"
      ? nodeGraphOscilloscopeLatestSample(buffer, 0)
      : Number(buffer[buffer.length - 1]);
    if (Number.isFinite(sample)) {
      brightness = Math.max(0, Math.min(1, brightness + sample * 0.5));
    }
  }
  const size = Math.max(0, nodeGraphRgbShapeReadParam(nodeId, "size", 1));
  const width = Math.max(0, nodeGraphRgbShapeReadParam(nodeId, "width", 1));
  const height = Math.max(0, nodeGraphRgbShapeReadParam(nodeId, "height", 1));
  const x = nodeGraphRgbShapeReadParam(nodeId, "x", 0);
  const y = nodeGraphRgbShapeReadParam(nodeId, "y", 0);
  const shape = nodeGraphRgbShapeReadParam(nodeId, "shape", 0);
  const shapeParam = nodeGraphRgbShapeReadParam(nodeId, "shapeParam", 0.5);
  const blur = Math.max(0, Math.min(1, nodeGraphRgbShapeReadParam(nodeId, "blur", 0.35)));

  const cx = w * 0.5 + (x * w * 0.5);
  const cy = h * 0.5 - (y * h * 0.5);
  const minSide = Math.min(w, h);
  // Size 1 ≈ half min-side radius; Width/Height multiply axes independently.
  const halfW = Math.max(0.5, size * width * 0.5 * minSide);
  const halfH = Math.max(0.5, size * height * 0.5 * minSide);
  const shapeId = typeof RgbShapeMath !== "undefined" && typeof RgbShapeMath.shapeIdFromIndex === "function"
    ? RgbShapeMath.shapeIdFromIndex(shape)
    : (typeof normalizeTraceStampShape === "function"
      ? normalizeTraceStampShape(shape)
      : "circle");

  const peak = settings.gradientStops?.[settings.gradientStops.length - 1]?.color || "#f0f4ff";
  let rgb = [240, 244, 255];
  if (typeof nodeGraphSampleGradientStopsRgb === "function") {
    rgb = nodeGraphSampleGradientStopsRgb(settings.gradientStops, brightness, peak);
  }
  const tint = face._rgbShapeGlTint || (face._rgbShapeGlTint = [1, 1, 1, 1]);
  tint[0] = rgb[0] / 255;
  tint[1] = rgb[1] / 255;
  tint[2] = rgb[2] / 255;
  // Same soft-edge SDF stamp as LED Dot / LCD Dot (smoothstep blur 0…1): the
  // TraceDotSprite white coverage mask (cached per shape/size/blur), drawn as a
  // tinted textured quad; its texture is uploaded once per baked sprite.
  if (typeof TraceDotSprite !== "undefined" && typeof TraceDotSprite.ensureRect === "function") {
    const ext = TraceDotSprite.extents(Math.max(halfW, halfH), { shape: shapeId, shapeParam, rx: halfW, ry: halfH });
    const sprite = TraceDotSprite.ensureRect(ext.rx, ext.ry, blur, ext.shape, ext.shapeParam);
    if (sprite?.canvas) {
      // Sprites cap their radius; stretch back to the requested extents.
      const kx = ext.rx / Math.max(1e-6, sprite.rx);
      const ky = ext.ry / Math.max(1e-6, sprite.ry);
      const sw = sprite.width * kx;
      const sh = sprite.height * ky;
      nodeGraphGlLinesImage(batch, sprite.canvas, cx - sw * 0.5, cy - sh * 0.5, sw, sh, { nearest: false, tint, cache: true });
    }
  }

  // Phase cursor on the outline (when live X/Y available from buffer pair).
  if (buffer?.nodeGraphScopeXy && Number.isFinite(buffer.x) && Number.isFinite(buffer.y)) {
    const px = cx + buffer.x * halfW;
    const py = cy - buffer.y * halfH;
    nodeGraphGlLinesDot(batch, px, py, Math.max(2, minSide * 0.02) - 0.35, 0.7, RGB_SHAPE_GL_WHITE);
  }
  if (!nodeGraphGlLinesEnd(batch)) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
  }

  if (face.dataset) {
    face.dataset.lightStrength = "1";
  }
  return true;
}

function paintNodeGraphRgbShapeFaceForNode(nodeId) {
  const id = String(nodeId || "").trim();
  if (!id) {
    return false;
  }
  const article = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(id) : null;
  const face = article?.querySelector?.(".node-rgb-shape-face");
  const canvas = face?.querySelector?.(".node-rgb-shape-canvas");
  if (!face || !canvas) {
    return false;
  }
  return paintNodeGraphRgbShapeFace(canvas, face, id, null);
}

function drawNodeGraphRgbShapeFaceItem(renderer, item, pixelRatio) {
  const slot = item?.slot;
  const face = item?.screenElement || slot?.scopeElement;
  const canvas = nodeGraphRgbShapeCanvasForSlot(slot);
  if (!slot || !face || !canvas) {
    return;
  }
  paintNodeGraphRgbShapeFace(canvas, face, slot.nodeId, item?.buffer);
  // rgba out: 2D face bridged into the node's picture texture (only when cabled).
  if (typeof nodeGraphPicturePublishCanvas === "function") nodeGraphPicturePublishCanvas(slot.nodeId, canvas);
}

// Face paints on its own rAF (rgb-shape-ui.js), like RoundShape / BasicShape.
// Do not override orchestrator stub — avoids double-draw and crash loops.
