// soemdsp:player:* postMessage API, version 1. A host page (any origin, as
// the direct parent; see ?origins=) loads tracks by URL or as bytes, drives
// the transport, and receives ready/state/error events. Sending bytes
// (ArrayBuffer / File / Blob) needs no CORS on the host's audio.
// Loading modes: "all" (default) binds every track up front; "lazy" binds
// metadata only and asks the host for one track's bytes (need-track) right
// before it plays, so only the playing track is held. See docs/EMBED.md "Player API".
(function soemdspPlayerApi() {
  const VERSION = 1;
  const PREFIX = "soemdsp:player:";
  let replyOrigin = "";
  let ready = false;
  const queue = [];
  let lastKey = "";
  // Lazy loading: a playlist generation (each lazy load bumps it) and the
  // outstanding need-track requests, keyed by requestId.
  let lazyGen = 0;
  let requestSeq = 0;
  const pending = new Map();
  const TRACK_TIMEOUT_MS = 120000;
  const urlLoading = (() => {
    try {
      return String(new URLSearchParams(window.location.search || "").get("loading") || "").trim().toLowerCase();
    } catch (_error) {
      return "";
    }
  })();
  const loadingMode = (value) => {
    const v = String(value || urlLoading || "all").trim().toLowerCase();
    return v === "lazy" ? "lazy" : "all";
  };

  const parentWindow = () => (window.parent && window.parent !== window ? window.parent : null);
  const nodeId = () => (Array.isArray(nodeGraphMvp?.patch?.nodes) ? nodeGraphMvp.patch.nodes : [])
    .find((node) => node?.type === "audioPlayer")?.id || "";
  const running = () => nodeGraphMvp?.live?.context?.state === "running";
  const baseName = (url) => {
    try {
      return decodeURIComponent(new URL(url, window.location.href).pathname.split("/").pop() || "");
    } catch (_error) {
      return "";
    }
  };

  function targetOrigin() {
    if (replyOrigin) return replyOrigin;
    let ref = "";
    try {
      ref = document.referrer ? new URL(document.referrer).origin : "";
    } catch (_error) {
      ref = "";
    }
    const allow = typeof nodeGraphExternalAllowedParentOrigins === "function" ? nodeGraphExternalAllowedParentOrigins() : null;
    if (ref && (ref === window.location.origin || !allow || allow.includes(ref))) return ref;
    if (Array.isArray(allow) && allow.length === 1) return allow[0];
    return "";
  }

  function emit(type, payload = {}, origin = "") {
    const parent = parentWindow();
    const target = origin || targetOrigin();
    if (!parent || !target) return;
    try {
      parent.postMessage({ type: PREFIX + type, version: VERSION, ...payload }, target);
    } catch (_error) {
      // Parent navigated away or origin mismatch.
    }
  }

  const error = (code, message, extra = {}) => emit("error", { code, message, ...extra });

  function state() {
    const id = nodeId();
    const node = id && typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(id) : null;
    const pl = id && typeof nodeGraphAudioPlayerPlaylistForNode === "function" ? nodeGraphAudioPlayerPlaylistForNode(id) : null;
    const items = Array.isArray(pl?.items) ? pl.items : [];
    const index = pl && typeof nodeGraphAudioPlayerPlaylistPlayingFrom === "function"
      ? nodeGraphAudioPlayerPlaylistPlayingFrom(id, pl)
      : Number(pl?.index ?? -1);
    const entry = node?.sample?.id ? nodeGraphMvp?.sampleBuffers?.get?.(node.sample.id) : null;
    const duration = entry?.frames > 0 ? entry.frames / Math.max(1, entry.sampleRate || 44100) : 0;
    const phase = id && typeof nodeGraphSamplePhaseForNode === "function" ? nodeGraphSamplePhaseForNode(id) : 0;
    const transport = Math.round(Number(node?.params?.transport));
    const item = items[index] || null;
    return {
      nodeId: id,
      playing: [3, 4, 5].includes(transport) && running() && Boolean(node?.sample?.id),
      paused: transport === 2,
      index: Number.isFinite(index) ? index : -1,
      count: items.length,
      title: String(item?.title || item?.name || node?.sample?.name || ""),
      position: Math.round(phase * duration * 1000) / 1000,
      duration: Math.round(duration * 1000) / 1000,
      volume: Number(node?.params?.amplitude ?? 1),
      needsGesture: !running(),
    };
  }

  function tick() {
    if (!ready || !targetOrigin()) return;
    const s = state();
    const key = JSON.stringify({ ...s, position: s.playing ? s.position : Math.round(s.position) });
    if (key !== lastKey) {
      lastKey = key;
      emit("state", s);
    }
  }

  async function startAudio() {
    if (typeof nodeGraphAudioPlayerEnsureLiveOutput === "function") {
      await nodeGraphAudioPlayerEnsureLiveOutput();
    } else if (typeof nodeGraphExternalStartLiveOutput === "function") {
      nodeGraphExternalStartLiveOutput();
    }
    const until = Date.now() + 800;
    while (!running() && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    if (!running()) {
      error("autoplay-blocked", "The browser needs a click in the player before audio can start.");
    }
  }

  function trackFile(track, i) {
    const title = String(track.title || "").trim();
    const name = String(track.name || "").trim() || baseName(track.url || "") || `track-${i + 1}.audio`;
    const blob = track.file instanceof Blob ? track.file
      : track.bytes instanceof ArrayBuffer || ArrayBuffer.isView(track.bytes) ? new Blob([track.bytes], { type: track.mime || "" })
        : null;
    if (!blob) return null;
    return { file: new File([blob], name, { type: blob.type || track.mime || "", lastModified: Number(track.lastModified) || i }), title };
  }

  function lazyCards(tracks) {
    lazyGen += 1;
    for (const [, req] of pending) req.reject(new Error("playlist replaced"));
    pending.clear();
    return tracks.map((t, i) => {
      const name = String(t.title || t.name || baseName(t.url || "") || `track ${i + 1}`).trim();
      const size = Number(typeof t.bytes === "number" ? t.bytes : t.size);
      return {
        name,
        fileKey: `host-${lazyGen}-${i}`,
        hostIndex: i,
        hostGen: lazyGen,
        ...(Number.isFinite(size) && size > 0 ? { bytes: size } : {}),
      };
    });
  }

  /** Ask the host for one lazy track's bytes; resolves to a File. */
  function requestTrack(item) {
    const index = Math.round(Number(item?.hostIndex));
    if (!Number.isFinite(index) || item?.hostGen !== lazyGen) {
      return Promise.reject(new Error("track is not from the current host playlist"));
    }
    if (!parentWindow() || !targetOrigin()) {
      return Promise.reject(new Error("no host page to fetch the track from"));
    }
    requestSeq += 1;
    const requestId = `t${lazyGen}-${requestSeq}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`host did not send ${item.name || "track"} in time`));
      }, TRACK_TIMEOUT_MS);
      pending.set(requestId, {
        index,
        name: String(item.name || ""),
        resolve: (file) => { window.clearTimeout(timer); resolve(file); },
        reject: (e) => { window.clearTimeout(timer); reject(e); },
      });
      emit("need-track", { index, requestId, title: String(item.name || "") });
    });
  }

  function receiveTrack(msg) {
    const requestId = String(msg.requestId || "");
    const req = pending.get(requestId);
    if (!req) return;
    pending.delete(requestId);
    if (msg.error) {
      req.reject(new Error(`${req.name || "track"}: ${String(msg.error)}`));
      return;
    }
    const got = trackFile({ ...msg, title: req.name, name: msg.name || req.name }, req.index);
    if (!got) {
      req.reject(new Error("track reply needs bytes (ArrayBuffer) or file (Blob)"));
      return;
    }
    req.resolve(got.file);
  }

  async function load(id, msg) {
    const tracks = Array.isArray(msg.tracks) ? msg.tracks.filter((t) => t && typeof t === "object") : [];
    if (!tracks.length) return error("bad-request", "load needs tracks: [{ url } | { bytes } | { file }]");
    const lazy = loadingMode(msg.loading) === "lazy";
    const asBytes = lazy ? [] : tracks.map(trackFile);
    let cards;
    if (lazy) {
      cards = lazyCards(tracks);
    } else if (asBytes.every(Boolean)) {
      const picked = nodeGraphAudioPlayerLibraryRememberPickedFiles(id, asBytes.map((t) => t.file)) || [];
      cards = picked.map((card, i) => (asBytes[i]?.title ? { ...card, name: asBytes[i].title, title: asBytes[i].title } : card));
    } else if (asBytes.some(Boolean)) {
      return error("bad-request", "load: send either all bytes/files or all urls, not a mix");
    } else {
      cards = tracks.map((t, i) => {
        if (!t.url) return null;
        const url = new URL(String(t.url), window.location.href).href;
        return { url, name: String(t.title || baseName(url) || `track ${i + 1}`) };
      }).filter(Boolean);
    }
    if (!cards.length) return error("bad-request", "load: no usable tracks");
    nodeGraphAudioPlayerLibraryBindCards(id, cards, { folderDive: false, folderPath: "", persist: false });
    document.documentElement.dataset.soemdspEmbedTracks = String(cards.length);
    const start = Math.max(0, Math.min(cards.length - 1, Math.round(Number(msg.startIndex) || 0)));
    if (msg.autoplay) await play(id, start);
    else {
      const pl = typeof nodeGraphAudioPlayerPlaylistForNode === "function"
        ? nodeGraphAudioPlayerPlaylistForNode(id)
        : null;
      if (pl) {
        pl.index = start;
        pl.selectedIndex = start;
      }
    }
    // Keep the visible page in sync with the stored face after the playlist changes.
    if (typeof nodeGraphAudioPlayerPlaylistApplyFace === "function") nodeGraphAudioPlayerPlaylistApplyFace(id);
  }

  function playlistLen(id) {
    const pl = typeof nodeGraphAudioPlayerPlaylistForNode === "function"
      ? nodeGraphAudioPlayerPlaylistForNode(id)
      : null;
    return Array.isArray(pl?.items) ? pl.items.length : 0;
  }

  function hostTrackCount(id) {
    const pl = typeof nodeGraphAudioPlayerPlaylistForNode === "function"
      ? nodeGraphAudioPlayerPlaylistForNode(id)
      : null;
    return Array.isArray(pl?.items) ? pl.items.filter((it) => it?.hostGen === lazyGen).length : 0;
  }

  function appendCardsToPlaylist(id, cards) {
    if (!cards.length) return;
    const pl = nodeGraphAudioPlayerPlaylistForNode(id);
    const start = Array.isArray(pl.items) ? pl.items.length : 0;
    const numbered = cards.map((card, i) => ({ ...card, listNumber: start + i + 1 }));
    pl.items = [...(pl.items || []), ...numbered];
    pl.unplayed = [...(pl.unplayed || []), ...numbered];
    if (!pl.playing) pl.playing = numbered[0] || null;
    if (typeof nodeGraphAudioPlayerPlaylistSyncQueues === "function") {
      nodeGraphAudioPlayerPlaylistSyncQueues(pl);
    }
    const node = nodeGraphPatchNode(id);
    if (node) node.playlist = pl;
    if (typeof nodeGraphAudioPlayerPlaylistRefreshUi === "function") {
      nodeGraphAudioPlayerPlaylistRefreshUi(id);
    }
    if (typeof nodeGraphAudioPlayerPlaylistApplyFace === "function") {
      nodeGraphAudioPlayerPlaylistApplyFace(id);
    }
    document.documentElement.dataset.soemdspEmbedTracks = String(pl.items.length);
  }

  function lazyAppendCards(tracks, offset) {
    return tracks.map((t, i) => {
      const n = offset + i;
      const name = String(t.title || t.name || baseName(t.url || "") || `track ${n + 1}`).trim();
      const size = Number(typeof t.bytes === "number" ? t.bytes : t.size);
      return {
        name,
        fileKey: `host-${lazyGen}-${n}`,
        hostIndex: n,
        hostGen: lazyGen,
        ...(Number.isFinite(size) && size > 0 ? { bytes: size } : {}),
      };
    });
  }

  async function append(id, msg) {
    const tracks = Array.isArray(msg.tracks) ? msg.tracks.filter((t) => t && typeof t === "object") : [];
    if (!tracks.length) return error("bad-request", "append needs tracks");
    const lazy = loadingMode(msg.loading) === "lazy";
    // Lazy hostIndex is the index in the HOST's list (current generation only),
    // not in the player's list, which can hold rows the host never sent.
    const offset = lazy ? hostTrackCount(id) : playlistLen(id);
    let cards;
    if (lazy) {
      cards = lazyAppendCards(tracks, offset);
    } else {
      const asBytes = tracks.map(trackFile);
      if (asBytes.every(Boolean)) {
        const picked = nodeGraphAudioPlayerLibraryRememberPickedFiles(id, asBytes.map((t) => t.file)) || [];
        cards = picked.map((card, i) => (asBytes[i]?.title ? { ...card, name: asBytes[i].title, title: asBytes[i].title } : card));
      } else if (asBytes.some(Boolean)) {
        return error("bad-request", "append: send either all bytes/files or all urls, not a mix");
      } else {
        cards = tracks.map((t, i) => {
          if (!t.url) return null;
          const url = new URL(String(t.url), window.location.href).href;
          return { url, name: String(t.title || baseName(url) || `track ${offset + i + 1}`) };
        }).filter(Boolean);
      }
    }
    if (!cards.length) return error("bad-request", "append: no usable tracks");
    appendCardsToPlaylist(id, cards);
  }

  function clearPlaylist(id) {
    lazyGen += 1;
    for (const [, req] of pending) req.reject(new Error("playlist cleared"));
    pending.clear();
    if (typeof nodeGraphAudioPlayerPlaylistStop === "function") {
      nodeGraphAudioPlayerPlaylistStop(id);
    }
    // Unbind the decoded track BEFORE emptying the list: a refresh with a bound
    // sample re-adds it as a row (EnsureCurrentSample), so Clear left the last
    // played track behind and later appends were offset by it.
    if (typeof nodeGraphAudioPlayerPlaylistUnbindCurrentSample === "function") {
      nodeGraphAudioPlayerPlaylistUnbindCurrentSample(id);
    }
    nodeGraphAudioPlayerLibraryBindCards(id, [], { folderDive: false, folderPath: "", persist: false });
    if (typeof nodeGraphAudioPlayerPlaylistRefreshUi === "function") {
      nodeGraphAudioPlayerPlaylistRefreshUi(id);
    }
    document.documentElement.dataset.soemdspEmbedTracks = "0";
    if (typeof nodeGraphAudioPlayerPlaylistApplyFace === "function") {
      nodeGraphAudioPlayerPlaylistApplyFace(id);
    }
  }

  async function play(id, index) {
    await startAudio();
    const node = nodeGraphPatchNode(id);
    const pl = nodeGraphAudioPlayerPlaylistForNode(id);
    try {
      if (Number.isFinite(index) || !node?.sample?.id) {
        await nodeGraphAudioPlayerLibraryPlayIndex(id, Number.isFinite(index) ? index : Math.max(0, pl?.index || 0), { autoplay: true });
      } else {
        nodeGraphAudioPlayerWriteTransport(id, nodeGraphAudioPlayerPlaylistPlayModeForLoop(pl?.loopMode));
      }
    } catch (e) {
      error("decode", String(e?.message || e), { index });
    }
  }

  function setVolume(id, value) {
    const v = Math.max(0, Math.min(1, Number(value)));
    if (!Number.isFinite(v)) return error("bad-request", "volume needs value 0..1");
    const slider = document.querySelector(`.dsp-node[data-node="${CSS.escape(id)}"] input[data-param="amplitude"]`);
    if (slider && typeof setNodeSliderValue === "function") {
      setNodeSliderValue(slider, v, { interaction: "program" });
    } else {
      const node = nodeGraphPatchNode(id);
      node.params = { ...(node.params || {}), amplitude: String(v) };
      if (typeof scheduleNodeGraphLiveParameterSync === "function") scheduleNodeGraphLiveParameterSync();
    }
  }

  async function handle(msg, origin) {
    const id = nodeId();
    if (!id) return error("no-player", "this patch has no Music Player module");
    const cmd = msg.type.slice(PREFIX.length);
    switch (cmd) {
      case "load": await load(id, msg); break;
      case "append": await append(id, msg); break;
      case "clear": clearPlaylist(id); break;
      case "play": await play(id, msg.index != null ? Math.round(Number(msg.index)) : undefined); break;
      case "pause": nodeGraphAudioPlayerWriteTransport(id, 2); break;
      case "stop": nodeGraphAudioPlayerPlaylistStop(id); break;
      case "next": nodeGraphAudioPlayerPlaylistPlayNext(id); break;
      case "prev": nodeGraphAudioPlayerPlaylistPlayPrev(id); break;
      case "select": {
        const i = Math.round(Number(msg.index));
        if (!Number.isFinite(i)) return error("bad-request", "select needs index");
        if (msg.play) await play(id, i);
        else await nodeGraphAudioPlayerLibraryPlayIndex(id, i, { autoplay: false }).catch((e) => error("decode", String(e?.message || e), { index: i }));
        break;
      }
      case "seek": {
        const s = state();
        const pos = msg.position != null ? Number(msg.position) : s.duration > 0 ? Number(msg.seconds) / s.duration : NaN;
        if (!Number.isFinite(pos)) return error("bad-request", "seek needs seconds (track loaded) or position 0..1");
        nodeGraphAudioPlayerPlaylistApplyScrub(id, Math.max(0, Math.min(1, pos)), { record: false, commit: true });
        break;
      }
      case "volume": setVolume(id, msg.value); break;
      case "track": receiveTrack(msg); return;
      case "get-state": emit("state", state(), origin); return;
      default: return error("unknown-type", `unknown message ${msg.type}`);
    }
    window.setTimeout(tick, 50);
  }

  window.addEventListener("message", (event) => {
    const msg = event.data && typeof event.data === "object" ? event.data : null;
    if (!msg || typeof msg.type !== "string" || !msg.type.startsWith(PREFIX)) return;
    if (typeof nodeGraphExternalPlayerMessageAllowed !== "function" || !nodeGraphExternalPlayerMessageAllowed(event)) return;
    if (event.source === parentWindow()) replyOrigin = event.origin;
    const run = () => handle(msg, event.origin).catch((e) => error("internal", String(e?.message || e)));
    if (ready) run();
    else queue.push(run);
  });

  function onReady() {
    ready = true;
    emit("ready", { patch: String(nodeGraphMvp?.loadedPatchSlug || ""), nodeId: nodeId() });
    while (queue.length) queue.shift()();
    window.setInterval(tick, 250);
  }
  if (document.documentElement.dataset.nodeSandboxInterfaceReady === "true") onReady();
  else window.addEventListener("nodeSandboxInterfaceReady", onReady, { once: true });

  window.soemdspPlayerApiState = state;
  // Library hook (audio-player-library.js): fetch a lazy track's bytes from the host.
  window.soemdspPlayerHostTrack = requestTrack;

  // Embed (soundemote-com /music): Space play/pause. Iframe has focus, so the
  // host page cannot see the key unless we handle it here.
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space" && event.key !== " ") return;
    if (!document.documentElement.classList.contains("soemdsp-embed")) return;
    const el = event.target instanceof Element ? event.target : null;
    if (el?.closest?.("input, textarea, select, [contenteditable='true']")) return;
    event.preventDefault();
    const id = nodeId();
    if (id && typeof nodeGraphAudioPlayerPlaylistTogglePlayPause === "function") {
      nodeGraphAudioPlayerPlaylistTogglePlayPause(id);
      window.setTimeout(tick, 50);
    }
  });
})();
