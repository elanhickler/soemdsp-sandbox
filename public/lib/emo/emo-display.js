// Script module face: the display {} block is a WebGL2 fragment on the shared
// picture device. 📺 in is rgbaIn. 📺 out publishes this plate. delayFrame(ago)
// reads the last 8 stored frames (ago 0 is prev).
(function initNodeGraphEmoDisplay(root) {
  const started = typeof performance !== "undefined" ? performance.now() : 0;

  function nodeIdOf(nodeOrId) {
    if (nodeOrId && typeof nodeOrId === "object") {
      return String(nodeOrId.dataset?.node || nodeOrId.id || "");
    }
    return String(nodeOrId || "");
  }

  function latestShow(nodeId, name) {
    const buffers = root.nodeGraphModuleScopeState?.buffers;
    const ring = buffers?.get?.(`${nodeId}:emo:${name}`);
    if (!ring?.length) return 0;
    const retained = Number(ring.nodeGraphScopeRetainedSampleCount) || 0;
    if (retained <= 0) return 0;
    const value = Number(ring[ring.length - 1]);
    return Number.isFinite(value) ? value : 0;
  }

  function floatUniforms(node) {
    const names = [];
    const floats = {};
    const params = Array.isArray(node?.emoParamOrder) ? node.emoParamOrder : [];
    for (const key of params) {
      names.push(key);
      const namesOfChoice = node?.emoChoices?.[key];
      const raw = node?.params?.[key];
      if (Array.isArray(namesOfChoice) && namesOfChoice.length) {
        const idx = namesOfChoice.indexOf(String(raw ?? ""));
        floats[key] = idx >= 0 ? idx : (Number(raw) || 0);
      } else {
        const value = Number(raw);
        floats[key] = Number.isFinite(value) ? value : 0;
      }
    }
    for (const show of node?.emoShows || []) {
      if (!show?.name || show.mode === "trace") continue;
      if (!names.includes(show.name)) names.push(show.name);
      floats[show.name] = latestShow(node.id, show.name);
    }
    return { names, floats };
  }

  function drawNodeGraphEmoScriptDisplay(section) {
    if (!section?.isConnected) return;
    const canvas = section.querySelector("canvas");
    if (!canvas || typeof root.nodeGraphSizeDisplayCanvas !== "function") return;
    const metrics = root.nodeGraphSizeDisplayCanvas(section, canvas, { pixelDensity: 1 });
    if (!metrics) return;
    const nodeId = nodeIdOf(section);
    const node = typeof root.nodeGraphPatchNode === "function" ? root.nodeGraphPatchNode(nodeId) : null;
    const userBody = String(node?.emoDisplay || "");
    if (!userBody.trim()) {
      if (typeof root.nodeGraphGlLinesFillBlack === "function") root.nodeGraphGlLinesFillBlack(canvas);
      return;
    }
    const picture = typeof root.nodeGraphPictureRead === "function"
      ? (root.nodeGraphPictureRead(nodeId, "rgba") || root.nodeGraphPictureRead(nodeId, "📺"))
      : null;
    const policy = typeof root.scopePaintFacePolicy === "function" ? root.scopePaintFacePolicy("param") : null;
    const advance = !policy || policy.animate !== false || section._emoScriptForce === true;
    section._emoScriptForce = false;
    const pack = floatUniforms(node);
    const drawn = typeof root.nodeGraphGlLinesUserShader === "function"
      ? root.nodeGraphGlLinesUserShader({
        key: nodeId,
        canvas,
        userBody,
        floatNames: pack.names,
        floats: pack.floats,
        picture,
        advance,
        publishNodeId: nodeId,
        time: ((typeof performance !== "undefined" ? performance.now() : 0) - started) / 1000,
      })
      : { ok: false, error: "shader quad missing" };
    if (node) node.emoShaderError = drawn.ok ? "" : String(drawn.error || "shader failed");
    if (!drawn.ok && typeof root.nodeGraphGlLinesFillBlack === "function") {
      root.nodeGraphGlLinesFillBlack(canvas);
    }
  }

  function createNodeGraphEmoScriptDisplay(nodeOrId, type) {
    const id = nodeIdOf(nodeOrId);
    const section = document.createElement("section");
    section.className = "node-filter-curve-display node-emo-script-display node-module-face";
    section.dataset.node = id;
    section.dataset.nodeType = String(type || "script");
    section.dataset.parameterVisual = "true";
    const canvas = root.nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-emo-script-canvas node-display-canvas");
    section.append(canvas);
    if (typeof root.nodeGraphInstallDrawingFacePump === "function") {
      root.nodeGraphInstallDrawingFacePump(section, {
        paintKind: "param",
        clockKey: "emoScript",
        rafKey: "_emoScriptRaf",
        forceKey: "_emoScriptForce",
        paintOnCreate: true,
        shouldAnimate() {
          const policy = typeof root.scopePaintFacePolicy === "function" ? root.scopePaintFacePolicy("param") : null;
          return !policy || policy.animate !== false;
        },
        paint(host) {
          drawNodeGraphEmoScriptDisplay(host);
        },
      });
    } else {
      requestAnimationFrame(() => drawNodeGraphEmoScriptDisplay(section));
    }
    return section;
  }

  if (typeof root.registerNodeGraphModuleFaceCreator === "function") {
    root.registerNodeGraphModuleFaceCreator("emoScript", createNodeGraphEmoScriptDisplay);
  }
  root.drawNodeGraphEmoScriptDisplay = drawNodeGraphEmoScriptDisplay;
})(typeof globalThis !== "undefined" ? globalThis : window);
