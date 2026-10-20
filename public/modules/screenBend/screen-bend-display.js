function nodeGraphScreenBendReadParam(nodeId, key, fallback) {
  if (typeof nodeGraphReadNodeNumber === "function") {
    const n = nodeGraphReadNodeNumber(nodeId, key);
    if (Number.isFinite(n)) return n;
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const raw = Number(node?.params?.[key]);
  return Number.isFinite(raw) ? raw : fallback;
}

function nodeGraphScreenBendClamp(value, lo, hi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function nodeGraphScreenBendEnsureCanvas(face) {
  if (!face) return null;
  for (const leftover of face.querySelectorAll(":scope > .node-module-scope-local-fallback-canvas")) {
    leftover.remove();
  }
  let canvas = face.querySelector(":scope > .node-screen-bend-canvas");
  if (!canvas) {
    canvas = nodeGraphDisplayCanvasCreate("node-screen-bend-canvas");
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

function nodeGraphScreenBendCircuitLive() {
  try {
    if (typeof nodeGraphModuleScopeEnginePaused === "function" && nodeGraphModuleScopeEnginePaused()) return false;
  } catch (_e) { /* fall through */ }
  try {
    if (typeof scopePaintIsFrozen === "function" && scopePaintIsFrozen()) return false;
  } catch (_e) { /* fall through */ }
  return true;
}

function drawNodeGraphScreenBendFaceItem(_renderer, item) {
  const slot = item?.slot;
  const face = item?.screenElement || slot?.scopeElement;
  if (!slot || !face) return;
  const canvas = nodeGraphScreenBendEnsureCanvas(face);
  if (!canvas) return;
  const ctx = typeof nodeGraphDisplayCanvasPresentContext === "function"
    ? nodeGraphDisplayCanvasPresentContext(canvas)
    : null;
  if (!ctx) return;
  if (face._screenBendOwnsClock && item?.fromFaceLoop !== true && item?.force !== true) return;
  const nodeId = slot.nodeId;
  const picture = typeof nodeGraphPictureRead === "function"
    ? (nodeGraphPictureRead(nodeId, "rgba") || nodeGraphPictureRead(nodeId, "📺"))
    : null;
  if (typeof nodeGraphScreenBendGlEnsure !== "function") {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  const renderer = nodeGraphScreenBendGlEnsure(canvas, canvas.width, canvas.height);
  if (!renderer) {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  if (nodeGraphScreenBendCircuitLive() && typeof nodeGraphScreenBendGlStep === "function") {
    nodeGraphScreenBendGlStep(canvas, {
      nodeId,
      width: nodeGraphScreenBendClamp(nodeGraphScreenBendReadParam(nodeId, "width", 0.55), -1, 1),
      height: nodeGraphScreenBendClamp(nodeGraphScreenBendReadParam(nodeId, "height", 0.55), -1, 1),
      picture,
    });
  }
  if (typeof nodeGraphScreenBendGlPresent === "function") {
    nodeGraphScreenBendGlPresent(canvas, ctx, canvas.width, canvas.height);
  }
  if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
    nodeGraphModuleScopeMarkScreenLit(face, 1);
  }
}

function wipeNodeGraphScreenBendScreensToColdBoot(canvas) {
  if (canvas && typeof nodeGraphScreenBendGlWipe === "function") nodeGraphScreenBendGlWipe(canvas);
  if (canvas && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.screenBendFace = drawNodeGraphScreenBendFaceItem;
}
if (typeof nodeGraphModuleScopeRegisterFaceWipe === "function") {
  nodeGraphModuleScopeRegisterFaceWipe("screenBendFace", (canvas) => {
    wipeNodeGraphScreenBendScreensToColdBoot(canvas);
  });
}
