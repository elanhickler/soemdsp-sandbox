function nodeGraphPlaceReadParam(nodeId, key, fallback) {
  if (typeof nodeGraphReadNodeNumber === "function") {
    const n = nodeGraphReadNodeNumber(nodeId, key);
    if (Number.isFinite(n)) return n;
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const raw = Number(node?.params?.[key]);
  return Number.isFinite(raw) ? raw : fallback;
}

function nodeGraphPlaceClamp(value, lo, hi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function nodeGraphPlaceEnsureCanvas(face) {
  if (!face) return null;
  for (const leftover of face.querySelectorAll(":scope > .node-module-scope-local-fallback-canvas")) {
    leftover.remove();
  }
  let canvas = face.querySelector(":scope > .node-place-canvas");
  if (!canvas) {
    canvas = nodeGraphDisplayCanvasCreate("node-place-canvas");
    canvas.setAttribute("aria-hidden", "true");
    face.appendChild(canvas);
  }
  if (typeof nodeGraphDisplayCanvasSize === "function") {
    const m = nodeGraphDisplayCanvasSize(face, canvas);
    if (m && (m.width < 8 || m.height < 8) && typeof nodeGraphDisplayCanvasSizeCss === "function") {
      nodeGraphDisplayCanvasSizeCss(canvas, Math.max(8, m.width) / m.pixelRatio, Math.max(8, m.height) / m.pixelRatio, 1);
    }
  }
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.zIndex = "5";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "none";
  return canvas;
}

function nodeGraphPlaceCircuitLive() {
  try {
    if (typeof nodeGraphModuleScopeEnginePaused === "function" && nodeGraphModuleScopeEnginePaused()) return false;
  } catch (_e) { /* fall through */ }
  try {
    if (typeof scopePaintIsFrozen === "function" && scopePaintIsFrozen()) return false;
  } catch (_e) { /* fall through */ }
  return true;
}

function drawNodeGraphPlaceFaceItem(_renderer, item) {
  const slot = item?.slot;
  const face = item?.screenElement || slot?.scopeElement;
  if (!slot || !face) return;
  const canvas = nodeGraphPlaceEnsureCanvas(face);
  if (!canvas) return;
  const ctx = typeof nodeGraphDisplayCanvasPresentContext === "function"
    ? nodeGraphDisplayCanvasPresentContext(canvas)
    : null;
  if (!ctx) return;
  if (face._placeOwnsClock && item?.fromFaceLoop !== true && item?.force !== true) return;
  const nodeId = slot.nodeId;
  const picture = typeof nodeGraphPictureRead === "function"
    ? (nodeGraphPictureRead(nodeId, "rgba") || nodeGraphPictureRead(nodeId, "📺"))
    : null;
  if (typeof nodeGraphPlaceGlEnsure !== "function") {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  const renderer = nodeGraphPlaceGlEnsure(canvas, canvas.width, canvas.height);
  if (!renderer) {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  if (nodeGraphPlaceCircuitLive() && typeof nodeGraphPlaceGlStep === "function") {
    nodeGraphPlaceGlStep(canvas, {
      nodeId,
      x: nodeGraphPlaceClamp(nodeGraphPlaceReadParam(nodeId, "x", 0), -1, 1),
      y: nodeGraphPlaceClamp(nodeGraphPlaceReadParam(nodeId, "y", 0), -1, 1),
      rotate: nodeGraphPlaceClamp(nodeGraphPlaceReadParam(nodeId, "rotate", 0), -1, 1),
      zoom: nodeGraphPlaceClamp(nodeGraphPlaceReadParam(nodeId, "zoom", 0), -1, 1),
      picture,
    });
  }
  if (typeof nodeGraphPlaceGlPresent === "function") {
    nodeGraphPlaceGlPresent(canvas, ctx, canvas.width, canvas.height);
  }
  if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
    nodeGraphModuleScopeMarkScreenLit(face, 1);
  }
}

function wipeNodeGraphPlaceScreensToColdBoot(canvas) {
  if (canvas && typeof nodeGraphPlaceGlWipe === "function") nodeGraphPlaceGlWipe(canvas);
  if (canvas && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.placeFace = drawNodeGraphPlaceFaceItem;
}
if (typeof nodeGraphModuleScopeRegisterFaceWipe === "function") {
  nodeGraphModuleScopeRegisterFaceWipe("placeFace", (canvas) => {
    wipeNodeGraphPlaceScreensToColdBoot(canvas);
  });
}
