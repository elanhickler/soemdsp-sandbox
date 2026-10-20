function createNodeGraphPlaceBody(node, type) {
  const face = document.createElement("div");
  face.className = "node-module-scope-window node-place-face node-light-source node-module-face";
  face.dataset.node = node;
  face.dataset.nodeType = type;
  face.dataset.lightSource = "screen";
  face.dataset.lightStrength = "1";
  face.setAttribute("aria-label", `${nodeGraphNodeDisplayName(node)} place`);
  face.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden;background:#000000;";

  const canvas = nodeGraphDisplayCanvasCreate("node-place-canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "display:block;position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none;";
  face.append(canvas);
  return face;
}

function nodeGraphPlaceShouldAnimate(face) {
  if (typeof scopePaintIsVisualPaused === "function" && scopePaintIsVisualPaused()) return false;
  const speed = Number(typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.live?.speedMultiplier : 1);
  if (Number.isFinite(speed) && speed <= 0) return false;
  return !nodeGraphVideoGraphShouldSleep(face?.dataset?.node || "");
}

registerNodeGraphChromelessModuleUi("place", {
  createBody: createNodeGraphPlaceBody,
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
      body._placeOwnsClock = true;
      nodeGraphInstallDrawingFacePump(body, {
        rafKey: "_placeRaf",
        forceKey: "_placeForce",
        clockKey: "place",
        shouldAnimate: nodeGraphPlaceShouldAnimate,
        paintOnCreate: true,
        paint(host) {
          if (typeof drawNodeGraphPlaceFaceItem !== "function") return;
          const nodeId = host.dataset?.node || node;
          const slot = typeof nodeGraphModuleScopeState !== "undefined"
            ? nodeGraphModuleScopeState?.slots?.get?.(nodeId)
            : null;
          drawNodeGraphPlaceFaceItem(null, {
            fromFaceLoop: true,
            screenElement: host,
            slot: slot || { nodeId, scopeElement: host, type },
          }, 1);
        },
      });
    }
  },
});
