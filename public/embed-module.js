// ?module=<nodeId|type>: show one whole module full-frame (embed view).
// Pins it to the layout canvas at 0,0,1,1 without marking the patch dirty,
// limits the canvas to that module, opens perform mode, and for a Music
// Player opens the playlist page. See docs/EMBED.md.
(function soemdspEmbedModule() {
  const query = new URLSearchParams(window.location.search || "");
  const want = String(query.get("module") || "").trim();
  // ?mode=perform&embed=1 without ?module: the patch's own whole-module canvas
  // (node.ui.canvasWholeModule, e.g. patches/soundemotecommusicplayer.json).
  const performEmbed = !want
    && String(query.get("mode") || "").trim().toLowerCase() === "perform"
    && /^(1|true|yes)$/i.test(String(query.get("embed") || "").trim());
  if (!want && !performEmbed) {
    return;
  }

  function resolveNodeId() {
    const nodes = Array.isArray(nodeGraphMvp?.patch?.nodes) ? nodeGraphMvp.patch.nodes : [];
    if (performEmbed) {
      const whole = nodes.find((node) => node?.ui?.canvasWholeModule);
      return whole ? String(whole.id) : "";
    }
    const hit = nodes.find((node) => String(node?.id || "") === want)
      || nodes.find((node) => String(node?.type || "") === want);
    return hit ? String(hit.id) : "";
  }

  function start() {
    const id = resolveNodeId();
    if (!id) {
      console.warn(`[embed] ${want ? `?module=${want}: no module with that id or type` : "perform embed: no canvasWholeModule module"} in this patch`);
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
    // ?module= picks any module: mark it a whole-module tile in memory (embed never
    // saves) so canvas In/Out hiding applies to it like any canvasWholeModule tile.
    if (node && !node.ui?.canvasWholeModule) {
      node.ui = { ...(node.ui || {}), canvasWholeModule: true };
    }
    const opened = nodeGraphLayoutCanvasOpen("perform", { silent: true });
    // After opening: (re)opening the canvas restores the face DOM it saved, which
    // would hide the playlist page again (perform mode opens the canvas first).
    if (node?.type === "audioPlayer" && typeof nodeGraphAudioPlayerPlaylistSetFace === "function") {
      nodeGraphAudioPlayerPlaylistSetFace(id, "pl");
      // Perform boot re-opens the canvas a few times while settling; each re-open
      // restores the face DOM snapshot, so re-apply the playlist page after it.
      for (const ms of [150, 500, 1200, 2500]) {
        window.setTimeout(() => {
          if (typeof nodeGraphAudioPlayerPlaylistApplyFace === "function") nodeGraphAudioPlayerPlaylistApplyFace(id);
        }, ms);
      }
    }
    document.documentElement.dataset.soemdspWholeModule = opened ? id : "failed";
    window.addEventListener("soemdspWholeModuleRecaptured", (event) => {
      if (event.detail?.nodeId === id && node?.type === "audioPlayer"
        && typeof nodeGraphAudioPlayerPlaylistSetFace === "function") {
        nodeGraphAudioPlayerPlaylistSetFace(id, "pl");
      }
    });
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
