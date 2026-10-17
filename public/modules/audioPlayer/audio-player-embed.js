// Music Player embed: ?playlist=<manifest url> | ?src=<audio url>, ?autoplay=1.
// See docs/EMBED.md.
(function soemdspAudioPlayerEmbed() {
  const q = new URLSearchParams(window.location.search || "");
  const flag = (name) => ["1", "true", "yes"].includes(String(q.get(name) || "").trim().toLowerCase());
  const playlistParam = String(q.get("playlist") || "").trim();
  const srcParam = String(q.get("src") || "").trim();
  const autoplay = flag("autoplay");
  if (!playlistParam && !srcParam) {
    return;
  }

  const log = (level, message, extra) => {
    if (typeof nodeGraphAudioPlayerLog === "function") nodeGraphAudioPlayerLog(level, `embed: ${message}`, extra);
  };
  const baseName = (url) => {
    try {
      return decodeURIComponent(new URL(url).pathname.split("/").pop() || "") || url;
    } catch (_error) {
      return url;
    }
  };

  function playerNodeId() {
    const nodes = Array.isArray(nodeGraphMvp?.patch?.nodes) ? nodeGraphMvp.patch.nodes : [];
    return nodes.find((node) => node?.type === "audioPlayer")?.id || "";
  }

  async function readTracks() {
    if (srcParam) {
      const url = new URL(srcParam, window.location.href).href;
      return [{ url, name: baseName(url) }];
    }
    const res = await fetch(new URL(playlistParam, window.location.href).href, { mode: "cors" });
    if (!res.ok) throw new Error(`playlist ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : Array.isArray(data?.tracks) ? data.tracks : [];
    return list
      .map((track) => {
        const raw = typeof track === "string" ? track : track?.url || track?.src || "";
        if (!raw) return null;
        const url = new URL(raw, res.url).href;
        return {
          url,
          name: String((typeof track === "object" && track.title) || baseName(url)),
          bytes: typeof track === "object" ? track.bytes : 0,
        };
      })
      .filter(Boolean);
  }

  function contextRunning() {
    return nodeGraphMvp?.live?.context?.state === "running";
  }

  async function waitFor(test, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (test()) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return test();
  }

  async function play(nodeId) {
    const live = nodeGraphMvp?.live;
    // A start begun without a gesture hangs in context.resume(); clear it so
    // this (gesture-backed) call creates a fresh, running AudioContext.
    if (live?.outputEnabled && !live.context && typeof setNodeGraphLiveOutputEnabled === "function") {
      await setNodeGraphLiveOutputEnabled(false);
    }
    if (typeof nodeGraphExternalStartLiveOutput === "function") nodeGraphExternalStartLiveOutput();
    const pl = typeof nodeGraphAudioPlayerPlaylistForNode === "function" ? nodeGraphAudioPlayerPlaylistForNode(nodeId) : null;
    await nodeGraphAudioPlayerLibraryPlayIndex(nodeId, Math.max(0, pl?.index || 0), { autoplay: true });
    return waitFor(contextRunning, 4000);
  }

  async function start() {
    const nodeId = playerNodeId();
    if (!nodeId) {
      log("FAIL", "patch has no Music Player node");
      return;
    }
    let tracks = [];
    try {
      tracks = await readTracks();
    } catch (error) {
      log("FAIL", `playlist load failed: ${error?.message || error}`, { playlist: playlistParam, src: srcParam });
      if (typeof nodeGraphAudioPlayerLibraryReport === "function") nodeGraphAudioPlayerLibraryReport(nodeId, "playlist failed to load (CORS?)");
      return;
    }
    if (!tracks.length) {
      log("FAIL", "playlist is empty");
      return;
    }
    nodeGraphAudioPlayerLibraryBindCards(nodeId, tracks, { folderDive: false, folderPath: "", persist: false });
    document.documentElement.dataset.soemdspEmbedTracks = String(tracks.length);
    log("INFO", "playlist bound", { nodeId, tracks: tracks.length });
    if (autoplay) {
      await play(nodeId).catch(() => false);
    }
  }

  const go = () => start().catch((error) => log("FAIL", String(error?.message || error)));
  if (document.documentElement.dataset.nodeSandboxInterfaceReady === "true") go();
  else window.addEventListener("nodeSandboxInterfaceReady", go, { once: true });
})();
