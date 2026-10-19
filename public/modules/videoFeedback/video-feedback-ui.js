// Feedback face: Layout A. Paint in video-feedback-display.js.

function createNodeGraphVideoFeedbackBody(node, type) {
  const face = document.createElement("div");
  face.className = "node-module-scope-window node-video-feedback-face node-light-source node-module-face";
  face.dataset.node = node;
  face.dataset.nodeType = type;
  face.dataset.lightSource = "screen";
  face.dataset.lightStrength = "1";
  face.setAttribute("aria-label", `${nodeGraphNodeDisplayName(node)} spectrum circle`);
  face.style.cssText = "position:relative;width:100%;height:100%;overflow:hidden;background:#000000;";

  const canvas = nodeGraphDisplayCanvasCreate("node-video-feedback-canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "display:block;position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none;";
  face.append(canvas);
  return face;
}

function nodeGraphVideoFeedbackShouldAnimate(face) {
  if (typeof scopePaintIsVisualPaused === "function" && scopePaintIsVisualPaused()) {
    return false;
  }
  const speed = Number(typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.live?.speedMultiplier : 1);
  if (Number.isFinite(speed) && speed <= 0) {
    return false;
  }
  // VG-4: runs while its face is on screen or a visible sink reads its
  // picture (even with its own face asleep / not in screen solo).
  return !nodeGraphVideoGraphShouldSleep(face?.dataset?.node || "");
}

registerNodeGraphChromelessModuleUi("videoFeedback", {
  createBody: createNodeGraphVideoFeedbackBody,
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
      body._videoFeedbackOwnsClock = true;
      nodeGraphInstallDrawingFacePump(body, {
        rafKey: "_videoFeedbackRaf",
        forceKey: "_videoFeedbackForce",
        clockKey: "videoFeedback",
        shouldAnimate: nodeGraphVideoFeedbackShouldAnimate,
        paintOnCreate: true,
        paint(host) {
          if (typeof drawNodeGraphVideoFeedbackFaceItem !== "function") {
            return;
          }
          const nodeId = host.dataset?.node || node;
          const slot = typeof nodeGraphModuleScopeState !== "undefined"
            ? nodeGraphModuleScopeState?.slots?.get?.(nodeId)
            : null;
          drawNodeGraphVideoFeedbackFaceItem(null, {
            fromFaceLoop: true,
            screenElement: host,
            slot: slot || { nodeId, scopeElement: host, type },
          }, 1); // sizing reads dpr in display-canvas.js
        },
      });
    }
  },
});
