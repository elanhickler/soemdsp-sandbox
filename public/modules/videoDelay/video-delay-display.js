const NODE_GRAPH_VIDEO_DELAY_PERIODS = Object.freeze([1, 2, 3, 4, 8]);

function nodeGraphVideoDelayPeriod(nodeId) {
  const idx = Math.round(nodeGraphVideoDelayReadParam(nodeId, "frames", 0));
  const i = Math.max(0, Math.min(NODE_GRAPH_VIDEO_DELAY_PERIODS.length - 1, idx));
  return NODE_GRAPH_VIDEO_DELAY_PERIODS[i] || 1;
}

function nodeGraphVideoDelayReadParam(nodeId, key, fallback) {
  if (typeof nodeGraphReadNodeNumber === "function") {
    const n = nodeGraphReadNodeNumber(nodeId, key);
    if (Number.isFinite(n)) return n;
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const raw = Number(node?.params?.[key]);
  return Number.isFinite(raw) ? raw : fallback;
}

function nodeGraphVideoDelayBufferFromKey(nodeId, port) {
  const state = typeof nodeGraphModuleScopeState === "object" ? nodeGraphModuleScopeState : null;
  if (!state?.buffers || !nodeId) return null;
  const names = [port, String(port).toLowerCase(), String(port).toUpperCase()];
  for (let i = 0; i < names.length; i += 1) {
    const ring = state.buffers.get(`${nodeId}:${names[i]}`);
    if (ring?.length) return ring;
  }
  if (typeof nodeGraphModuleScopeConnectedSourceBuffer === "function") {
    const connected = nodeGraphModuleScopeConnectedSourceBuffer(nodeId, port);
    if (connected?.length) return connected;
  }
  return null;
}

function nodeGraphVideoDelayLatest(ring) {
  if (!ring?.length) return 0;
  let n = ring.length;
  if (typeof nodeGraphScopeAvailableSampleCount === "function") {
    n = nodeGraphScopeAvailableSampleCount(ring) || n;
  }
  const v = Number(ring[n - 1]);
  return Number.isFinite(v) ? v : 0;
}

function nodeGraphVideoDelayEnsureCanvas(face, pixelRatio) {
  if (!face) return null;
  for (const leftover of face.querySelectorAll(":scope > .node-module-scope-local-fallback-canvas")) {
    leftover.remove();
  }
  let canvas = face.querySelector(":scope > .node-video-delay-canvas");
  if (!canvas) {
    canvas = nodeGraphDisplayCanvasCreate("node-video-delay-canvas");
    canvas.setAttribute("aria-hidden", "true");
    face.appendChild(canvas);
  }
  // Shared sizing (layout css x dpr, never zoom); backing stays >= 8 px.
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

function nodeGraphVideoDelayCircuitLive() {
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
  try {
    if (typeof nodeGraphModuleScopePhosphorFrozen === "function" && nodeGraphModuleScopePhosphorFrozen()) {
      return false;
    }
  } catch (_e) { /* fall through */ }
  return true;
}

function drawNodeGraphVideoDelayFaceItem(_renderer, item, pixelRatio) {
  const slot = item?.slot;
  const face = item?.screenElement || slot?.scopeElement;
  if (!slot || !face) return;
  const canvas = nodeGraphVideoDelayEnsureCanvas(face, pixelRatio);
  if (!canvas) return;
  // 2D present surface for the shared-GL blit (display-canvas.js); no 2D drawing here.
  const ctx = typeof nodeGraphDisplayCanvasPresentContext === "function" ? nodeGraphDisplayCanvasPresentContext(canvas) : null;
  if (!ctx) return;
  if (face._videoDelayOwnsClock && item?.fromFaceLoop !== true && item?.force !== true) {
    return;
  }
  const nodeId = slot.nodeId;
  const decay = Math.max(0, Math.min(1, nodeGraphVideoDelayReadParam(nodeId, "decay", 0.94)));
  const mix = Math.max(0, Math.min(1, nodeGraphVideoDelayReadParam(nodeId, "mix", 0.7)));
  const zoom = Math.max(0, Math.min(1, nodeGraphVideoDelayReadParam(nodeId, "zoom", 0.12)));
  const twist = Math.max(-1, Math.min(1, nodeGraphVideoDelayReadParam(nodeId, "twist", 0)));
  const panX = Math.max(-1, Math.min(1,
    nodeGraphVideoDelayReadParam(nodeId, "panX", 0) + 0.55 * nodeGraphVideoDelayLatest(nodeGraphVideoDelayBufferFromKey(nodeId, "X")),
  ));
  const panY = Math.max(-1, Math.min(1,
    nodeGraphVideoDelayReadParam(nodeId, "panY", 0) + 0.55 * nodeGraphVideoDelayLatest(nodeGraphVideoDelayBufferFromKey(nodeId, "Y")),
  ));
  const picture = typeof nodeGraphPictureRead === "function"
    ? (nodeGraphPictureRead(nodeId, "rgba") || nodeGraphPictureRead(nodeId, "📺"))
    : null;
  const frozen = !nodeGraphVideoDelayCircuitLive();
  const host = canvas;
  if (typeof nodeGraphVideoDelayGlEnsure !== "function") {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  const renderer = nodeGraphVideoDelayGlEnsure(host, canvas.width, canvas.height);
  if (!renderer) {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  if (!frozen && typeof nodeGraphVideoDelayGlStep === "function") {
    const period = nodeGraphVideoDelayPeriod(nodeId);
    if (canvas._videoDelayPeriod !== period) {
      canvas._videoDelayPeriod = period;
      canvas._videoDelayFrameAcc = period;
    }
    canvas._videoDelayFrameAcc = (Number(canvas._videoDelayFrameAcc) || 0) + 1;
    if (canvas._videoDelayFrameAcc >= period) {
      canvas._videoDelayFrameAcc = 0;
      nodeGraphVideoDelayGlStep(host, {
        nodeId,
        decay,
        mix,
        zoom,
        twist,
        panX,
        panY,
        picture,
      });
    }
  }
  if (typeof nodeGraphVideoDelayGlPresent === "function") {
    nodeGraphVideoDelayGlPresent(host, ctx, canvas.width, canvas.height);
  }
  if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
    nodeGraphModuleScopeMarkScreenLit(face, 1);
  }
}

function wipeNodeGraphVideoDelayScreensToColdBoot(canvas) {
  const host = canvas || null;
  if (canvas) {
    canvas._videoDelayFrameAcc = 0;
    canvas._videoDelayPeriod = 0;
  }
  if (host && typeof nodeGraphVideoDelayGlWipe === "function") {
    nodeGraphVideoDelayGlWipe(host);
  }
  if (canvas && typeof nodeGraphGlLinesFillBlack === "function") {
    nodeGraphGlLinesFillBlack(canvas);
  }
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.videoDelayFace = drawNodeGraphVideoDelayFaceItem;
}
if (typeof nodeGraphModuleScopeRegisterFaceWipe === "function") {
  nodeGraphModuleScopeRegisterFaceWipe("videoDelayFace", (canvas) => {
    wipeNodeGraphVideoDelayScreensToColdBoot(canvas);
  });
}
