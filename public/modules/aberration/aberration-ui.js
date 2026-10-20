function createNodeGraphAberrationBody(node, type) {
  const face = document.createElement("div");
  face.className = "node-module-scope-window node-aberration-face node-light-source node-module-face";
  face.dataset.node = node;
  face.dataset.nodeType = type;
  face.dataset.lightSource = "screen";
  face.dataset.lightStrength = "1";
  face.setAttribute("aria-label", `${nodeGraphNodeDisplayName(node)} aberration`);
  face.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden;background:#000000;";

  const canvas = nodeGraphDisplayCanvasCreate("node-aberration-canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "display:block;position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none;";
  face.append(canvas);
  return face;
}

function nodeGraphAberrationShouldAnimate(face) {
  if (typeof scopePaintIsVisualPaused === "function" && scopePaintIsVisualPaused()) {
    return false;
  }
  const speed = Number(typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.live?.speedMultiplier : 1);
  if (Number.isFinite(speed) && speed <= 0) {
    return false;
  }
  return !nodeGraphVideoGraphShouldSleep(face?.dataset?.node || "");
}

registerNodeGraphChromelessModuleUi("aberration", {
  createBody: createNodeGraphAberrationBody,
  afterMount(article, body, node, type) {
    if (typeof registerNodeGraphModuleScopeSlot === "function") {
      registerNodeGraphModuleScopeSlot(article, {
        nodeId: node,
        scopeElement: body,
        type,
        viewDrag: false,
      });
    }
    if (typeof nodeGraphInstallDrawingFacePump === "function") {
      body._aberrationOwnsClock = true;
      nodeGraphInstallDrawingFacePump(body, {
        rafKey: "_aberrationRaf",
        forceKey: "_aberrationForce",
        clockKey: "aberration",
        shouldAnimate: nodeGraphAberrationShouldAnimate,
        paintOnCreate: true,
        paint(host) {
          if (typeof drawNodeGraphAberrationFaceItem !== "function") {
            return;
          }
          const nodeId = host.dataset?.node || node;
          const slot = typeof nodeGraphModuleScopeState !== "undefined"
            ? nodeGraphModuleScopeState?.slots?.get?.(nodeId)
            : null;
          drawNodeGraphAberrationFaceItem(null, {
            fromFaceLoop: true,
            screenElement: host,
            slot: slot || { nodeId, scopeElement: host, type },
          }, 1);
        },
      });
    }
  },
});
