// ?module=<nodeId|type>: show one whole module full-frame (embed view).
// Pins it to the layout canvas at 0,0,1,1 without marking the patch dirty,
// limits the canvas to that module, opens perform mode, and for a Music
// Player opens the playlist page. See docs/EMBED.md.
(function soemdspEmbedModule() {
  const want = String(new URLSearchParams(window.location.search || "").get("module") || "").trim();
  if (!want) {
    return;
  }

  function resolveNodeId() {
    const nodes = Array.isArray(nodeGraphMvp?.patch?.nodes) ? nodeGraphMvp.patch.nodes : [];
    const hit = nodes.find((node) => String(node?.id || "") === want)
      || nodes.find((node) => String(node?.type || "") === want);
    return hit ? String(hit.id) : "";
  }

  function start() {
    const id = resolveNodeId();
    if (!id) {
      console.warn(`[embed] ?module=${want}: no module with that id or type in this patch`);
      return;
    }
    nodeGraphMvp.embedWholeModuleId = id;
    document.documentElement.classList.add("soemdsp-whole-module");
    // Only this module on the canvas, even if the patch pins others.
    const originalPinned = window.nodeGraphLayoutCanvasPinnedNodeIds;
    window.nodeGraphLayoutCanvasPinnedNodeIds = function embedPinnedNodeIds(...args) {
      const only = String(nodeGraphMvp?.embedWholeModuleId || "");
      return only ? [only] : originalPinned.apply(this, args);
    };
    nodeGraphLayoutCanvasSetPinned(id, true, { persist: false, refresh: false });
    nodeGraphLayoutCanvasWriteRect(id, { x: 0, y: 0, w: 1, h: 1, z: 0 }, { persist: false });
    const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(id) : null;
    if (node?.type === "audioPlayer" && typeof nodeGraphAudioPlayerPlaylistSetFace === "function") {
      nodeGraphAudioPlayerPlaylistSetFace(id, "pl");
    }
    const opened = nodeGraphLayoutCanvasOpen("perform", { silent: true });
    document.documentElement.dataset.soemdspWholeModule = opened ? id : "failed";
    window.addEventListener("soemdspWholeModuleRecaptured", (event) => {
      if (event.detail?.nodeId === id && node?.type === "audioPlayer"
        && typeof nodeGraphAudioPlayerPlaylistSetFace === "function") {
        nodeGraphAudioPlayerPlaylistSetFace(id, "pl");
      }
    });
    // ?playlist / ?src have their own overlay (audio-player-embed.js).
    const q = new URLSearchParams(window.location.search || "");
    if (opened && !q.get("playlist") && !q.get("src")) {
      window.setTimeout(maybeShowStartOverlay, 400);
    }
  }

  function audioAllowedNow() {
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      const probe = new Ctor();
      const ok = probe.state === "running";
      probe.close();
      return ok;
    } catch (_error) {
      return false;
    }
  }

  const running = () => nodeGraphMvp?.live?.context?.state === "running";

  // Perform mode starts audio; without a user gesture the browser blocks it.
  function maybeShowStartOverlay() {
    if (running() || audioAllowedNow() || document.querySelector(".soemdsp-embed-start")) {
      return;
    }
    const label = "\u25B6 Click to start";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "soemdsp-embed-start";
    button.textContent = label;
    button.setAttribute("aria-label", "Start audio");
    button.style.cssText = [
      "position:fixed", "inset:0", "z-index:2147483000", "display:flex", "align-items:center",
      "justify-content:center", "width:100%", "height:100%", "border:0", "cursor:pointer",
      "background:rgba(5,5,10,.55)", "color:#fff", "font:600 28px/1 system-ui,sans-serif",
    ].join(";");
    button.addEventListener("click", async () => {
      button.disabled = true;
      const live = nodeGraphMvp?.live;
      // The gesture-less start hangs in context.resume(); clear it, then start fresh.
      if (live?.outputEnabled && !live.context && typeof setNodeGraphLiveOutputEnabled === "function") {
        await setNodeGraphLiveOutputEnabled(false);
      }
      if (typeof nodeGraphExternalStartLiveOutput === "function") nodeGraphExternalStartLiveOutput();
      const until = Date.now() + 4000;
      while (!running() && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
      if (running()) button.remove();
      else button.disabled = false;
    });
    document.body.appendChild(button);
    document.documentElement.dataset.soemdspEmbedNeedsGesture = "true";
  }

  const go = () => {
    try {
      start();
    } catch (error) {
      console.warn("[embed] ?module failed", error);
      document.documentElement.dataset.soemdspWholeModule = "failed";
    }
  };
  if (document.documentElement.dataset.nodeSandboxInterfaceReady === "true") go();
  else window.addEventListener("nodeSandboxInterfaceReady", go, { once: true });
})();
