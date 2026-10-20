function nodeGraphAberrationReadParam(nodeId, key, fallback) {
  if (typeof nodeGraphReadNodeNumber === "function") {
    const n = nodeGraphReadNodeNumber(nodeId, key);
    if (Number.isFinite(n)) return n;
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const raw = Number(node?.params?.[key]);
  return Number.isFinite(raw) ? raw : fallback;
}

function nodeGraphAberrationClamp(value, lo, hi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function nodeGraphAberrationEnsureCanvas(face) {
  if (!face) return null;
  for (const leftover of face.querySelectorAll(":scope > .node-module-scope-local-fallback-canvas")) {
    leftover.remove();
  }
  let canvas = face.querySelector(":scope > .node-aberration-canvas");
  if (!canvas) {
    canvas = nodeGraphDisplayCanvasCreate("node-aberration-canvas");
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

function nodeGraphAberrationCircuitLive() {
  try {
    if (typeof nodeGraphModuleScopeEnginePaused === "function" && nodeGraphModuleScopeEnginePaused()) {
      return false;
    }
  } catch (_e) { /* fall through */ }
  try {
    if (typeof scopePaintIsFrozen === "function" && scopePaintIsFrozen()) {
      return false;
    }
  } catch (_e) { /* fall through */ }
  return true;
}

function nodeGraphAberrationChannel(nodeId, key) {
  return {
    bright: nodeGraphAberrationClamp(nodeGraphAberrationReadParam(nodeId, key + "Bright", 1), 0, 1),
    x: nodeGraphAberrationClamp(nodeGraphAberrationReadParam(nodeId, key + "X", 0), -1, 1) * 0.12,
    y: nodeGraphAberrationClamp(nodeGraphAberrationReadParam(nodeId, key + "Y", 0), -1, 1) * 0.12,
    blur: nodeGraphAberrationClamp(nodeGraphAberrationReadParam(nodeId, key + "Blur", 0), 0, 1),
  };
}

function drawNodeGraphAberrationFaceItem(_renderer, item) {
  const slot = item?.slot;
  const face = item?.screenElement || slot?.scopeElement;
  if (!slot || !face) return;
  const canvas = nodeGraphAberrationEnsureCanvas(face);
  if (!canvas) return;
  const ctx = typeof nodeGraphDisplayCanvasPresentContext === "function"
    ? nodeGraphDisplayCanvasPresentContext(canvas)
    : null;
  if (!ctx) return;
  if (face._aberrationOwnsClock && item?.fromFaceLoop !== true && item?.force !== true) {
    return;
  }
  const nodeId = slot.nodeId;
  const picture = typeof nodeGraphPictureRead === "function"
    ? (nodeGraphPictureRead(nodeId, "rgba") || nodeGraphPictureRead(nodeId, "📺"))
    : null;
  if (typeof nodeGraphAberrationGlEnsure !== "function") {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  const renderer = nodeGraphAberrationGlEnsure(canvas, canvas.width, canvas.height);
  if (!renderer) {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  if (nodeGraphAberrationCircuitLive() && typeof nodeGraphAberrationGlStep === "function") {
    nodeGraphAberrationGlStep(canvas, {
      nodeId,
      mode: nodeGraphAberrationReadParam(nodeId, "mode", 0) >= 0.5 ? 1 : 0,
      blend: nodeGraphAberrationReadParam(nodeId, "blend", 0) >= 0.5 ? 1 : 0,
      hue: nodeGraphAberrationClamp(nodeGraphAberrationReadParam(nodeId, "hue", 0), -1, 1),
      ch1: nodeGraphAberrationChannel(nodeId, "ch1"),
      ch2: nodeGraphAberrationChannel(nodeId, "ch2"),
      ch3: nodeGraphAberrationChannel(nodeId, "ch3"),
      picture,
    });
  }
  if (typeof nodeGraphAberrationGlPresent === "function") {
    nodeGraphAberrationGlPresent(canvas, ctx, canvas.width, canvas.height);
  }
  if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
    nodeGraphModuleScopeMarkScreenLit(face, 1);
  }
}

function wipeNodeGraphAberrationScreensToColdBoot(canvas) {
  if (canvas && typeof nodeGraphAberrationGlWipe === "function") {
    nodeGraphAberrationGlWipe(canvas);
  }
  if (canvas && typeof nodeGraphGlLinesFillBlack === "function") {
    nodeGraphGlLinesFillBlack(canvas);
  }
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.aberrationFace = drawNodeGraphAberrationFaceItem;
}
if (typeof nodeGraphModuleScopeRegisterFaceWipe === "function") {
  nodeGraphModuleScopeRegisterFaceWipe("aberrationFace", (canvas) => {
    wipeNodeGraphAberrationScreensToColdBoot(canvas);
  });
}
