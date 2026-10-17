// Music Player faces — wave / waveplay / playlist / playinfo / XY / LR.
// waveplay is the wave page plus one playlist-row song name (replays current track).
// playinfo is the decoded-buffer table. List UI + phase scrubber.

function nodeGraphAudioPlayerPlaylistNormalizeCardList(raw, startIndex = 0) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item, offset) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const index = startIndex + offset;
      const card = typeof nodeGraphAudioPlayerLibraryNormalizeCard === "function"
        ? nodeGraphAudioPlayerLibraryNormalizeCard(item, index)
        : null;
      if (!card) {
        return null;
      }
      const listNumber = Math.max(0, Math.round(nodeGraphFiniteNumber(item.listNumber)));
      if (listNumber) {
        card.listNumber = listNumber;
      }
      return card;
    })
    .filter(Boolean);
}

function nodeGraphAudioPlayerPlaylistItemKey(item) {
  return String(item?.path || item?.fileKey || item?.id || "").trim();
}

function nodeGraphAudioPlayerPlaylistFileName(item) {
  const raw = String(item?.name || item?.path || item?.fileKey || "").trim().replace(/\\/g, "/");
  const base = raw.split("/").pop() || raw;
  return base.split(":").shift() || base;
}

function nodeGraphAudioPlayerPlaylistSid(value) {
  return typeof normalizeNodeGraphSampleId === "function"
    ? normalizeNodeGraphSampleId(value)
    : String(value || "").trim();
}

function nodeGraphAudioPlayerPlaylistItemMatchesSample(item, sid) {
  const want = nodeGraphAudioPlayerPlaylistSid(sid);
  if (!item || !want) {
    return false;
  }
  if (nodeGraphAudioPlayerPlaylistSid(item.sampleId) === want) {
    return true;
  }
  if (item.path && nodeGraphAudioPlayerPlaylistSid(item.path) === want) {
    return true;
  }
  if (item.fileKey && nodeGraphAudioPlayerPlaylistSid(item.fileKey) === want) {
    return true;
  }
  if (item.sourcePath && nodeGraphAudioPlayerPlaylistSid(item.sourcePath) === want) {
    return true;
  }
  return false;
}

function nodeGraphAudioPlayerPlaylistFindItemForSample(pl, sid) {
  const want = nodeGraphAudioPlayerPlaylistSid(sid);
  if (!want || !pl) {
    return null;
  }
  const items = Array.isArray(pl.items) ? pl.items : [];
  if (pl.playing && nodeGraphAudioPlayerPlaylistItemMatchesSample(pl.playing, want)) {
    return pl.playing;
  }
  const withPath = items.find((item) => (
    (item.path || item.fileKey) && nodeGraphAudioPlayerPlaylistItemMatchesSample(item, want)
  ));
  if (withPath) {
    return withPath;
  }
  return items.find((item) => nodeGraphAudioPlayerPlaylistItemMatchesSample(item, want)) || null;
}

function nodeGraphAudioPlayerPlaylistRebuildItems(pl) {
  if (!pl || typeof pl !== "object") {
    return pl;
  }
  if (!Array.isArray(pl.items)) {
    pl.items = [];
  }
  const playingKey = nodeGraphAudioPlayerPlaylistItemKey(pl.playing);
  if (playingKey) {
    const found = pl.items.findIndex((item) => nodeGraphAudioPlayerPlaylistItemKey(item) === playingKey);
    if (found >= 0) {
      pl.index = found;
    }
  } else if (!pl.items.length) {
    pl.index = 0;
  } else {
    pl.index = Math.max(0, Math.min(pl.items.length - 1, Math.round(nodeGraphFiniteNumber(pl.index))));
  }
  pl.selectedIndex = pl.index;
  return pl;
}

function nodeGraphAudioPlayerPlaylistPlayedKeySet(pl) {
  return new Set(
    (Array.isArray(pl?.played) ? pl.played : [])
      .map((item) => nodeGraphAudioPlayerPlaylistItemKey(item))
      .filter(Boolean),
  );
}

function nodeGraphAudioPlayerPlaylistMarkPlayed(pl, item) {
  if (!pl || typeof pl !== "object" || !item) {
    return pl;
  }
  const key = nodeGraphAudioPlayerPlaylistItemKey(item);
  if (!key) {
    return pl;
  }
  if (!nodeGraphAudioPlayerPlaylistPlayedKeySet(pl).has(key)) {
    pl.played = [...(pl.played || []), item];
  }
  if (nodeGraphAudioPlayerPlaylistItemKey(pl.playing) === key) {
    pl.playing = null;
  }
  // Never splice out of `items`. Played = strikeout in the same list.
  return typeof nodeGraphAudioPlayerPlaylistSyncQueues === "function"
    ? nodeGraphAudioPlayerPlaylistSyncQueues(pl)
    : pl;
}

function nodeGraphAudioPlayerPlaylistRetirePlaying(pl) {
  if (!pl || typeof pl !== "object") {
    return pl;
  }
  return nodeGraphAudioPlayerPlaylistMarkPlayed(pl, pl.playing);
}

function nodeGraphAudioPlayerPlaylistMarkPlayedBySample(pl, sid) {
  const item = nodeGraphAudioPlayerPlaylistFindItemForSample(pl, sid) || pl?.playing || null;
  return nodeGraphAudioPlayerPlaylistMarkPlayed(pl, item);
}

/** Keep played / unplayed in list order. Never restack `items` when a track is played. */
function nodeGraphAudioPlayerPlaylistSyncQueues(pl) {
  if (!pl || typeof pl !== "object") {
    return pl;
  }
  const items = Array.isArray(pl.items) ? pl.items : [];
  const pathKeys = new Set(
    items
      .filter((item) => item?.path || item?.fileKey)
      .map((item) => nodeGraphAudioPlayerPlaylistSid(item.sampleId) || nodeGraphAudioPlayerPlaylistSid(item.path))
      .filter(Boolean),
  );
  if (pathKeys.size) {
    pl.items = items.filter((item) => {
      if (item?.path || item?.fileKey) {
        return true;
      }
      const sid = nodeGraphAudioPlayerPlaylistSid(item?.sampleId);
      return !sid || !pathKeys.has(sid);
    });
  }
  const list = Array.isArray(pl.items) ? pl.items : items;
  const playedKeys = nodeGraphAudioPlayerPlaylistPlayedKeySet(pl);
  const playingKey = nodeGraphAudioPlayerPlaylistItemKey(pl.playing);
  pl.played = list.filter((item) => {
    const key = nodeGraphAudioPlayerPlaylistItemKey(item);
    return key && playedKeys.has(key) && key !== playingKey;
  });
  pl.unplayed = list.filter((item) => {
    const key = nodeGraphAudioPlayerPlaylistItemKey(item);
    return key && key !== playingKey && !playedKeys.has(key);
  });
  if (playingKey) {
    const found = list.find((item) => nodeGraphAudioPlayerPlaylistItemKey(item) === playingKey);
    if (found) {
      pl.playing = found;
    }
  }
  const nextKey = nodeGraphAudioPlayerPlaylistItemKey(pl.playNext);
  if (nextKey && nextKey !== playingKey) {
    const found = list.find((item) => nodeGraphAudioPlayerPlaylistItemKey(item) === nextKey);
    pl.playNext = found || null;
  } else {
    pl.playNext = null;
  }
  return nodeGraphAudioPlayerPlaylistRebuildItems(pl);
}

function nodeGraphAudioPlayerPlaylistEnsureQueues(pl) {
  if (!pl || typeof pl !== "object") {
    return pl;
  }
  const hasQueues = Array.isArray(pl.played)
    && Array.isArray(pl.unplayed)
    && Object.prototype.hasOwnProperty.call(pl, "playing");
  if (hasQueues && Array.isArray(pl.items) && pl.items.length) {
    return nodeGraphAudioPlayerPlaylistSyncQueues(pl);
  }
  if (hasQueues) {
    const playing = pl.playing ? [pl.playing] : [];
    pl.items = [...pl.played, ...playing, ...pl.unplayed];
    return nodeGraphAudioPlayerPlaylistSyncQueues(pl);
  }
  const items = Array.isArray(pl.items) ? pl.items : [];
  const i = Math.max(0, Math.min(items.length ? items.length - 1 : 0, Math.round(nodeGraphFiniteNumber(pl.index))));
  pl.played = items.slice(0, i);
  pl.playing = items[i] || null;
  pl.unplayed = items.slice(i + 1);
  return nodeGraphAudioPlayerPlaylistRebuildItems(pl);
}

function nodeGraphAudioPlayerPlaylistNormalize(raw = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const hasQueues = Array.isArray(source.played) || Array.isArray(source.unplayed) || source.playing;
  const played = nodeGraphAudioPlayerPlaylistNormalizeCardList(source.played, 0);
  const playingList = source.playing
    ? nodeGraphAudioPlayerPlaylistNormalizeCardList([source.playing], played.length)
    : [];
  const unplayed = nodeGraphAudioPlayerPlaylistNormalizeCardList(
    source.unplayed,
    played.length + playingList.length,
  );
  const playNextList = source.playNext
    ? nodeGraphAudioPlayerPlaylistNormalizeCardList([source.playNext], 0)
    : [];
  let items = nodeGraphAudioPlayerPlaylistNormalizeCardList(source.items, 0);
  if (!items.length && hasQueues) {
    items = [...played, ...playingList, ...unplayed];
  }
  const index = Math.max(0, Math.min(items.length ? items.length - 1 : 0, Math.round(nodeGraphFiniteNumber(source.index))));
  const selectedIndex = Math.max(
    0,
    Math.min(items.length ? items.length - 1 : 0, Math.round(nodeGraphFiniteNumber(source.selectedIndex ?? source.index))),
  );
  const face = nodeGraphAudioPlayerPlaylistNormalizeFace(source.face);
  const shuffle = source.shuffle === true || source.shuffle === "true" || source.shuffle === 1;
  let loopMode = String(source.loopMode || "").trim().toLowerCase();
  if (loopMode !== "off" && loopMode !== "one" && loopMode !== "all") {
    loopMode = "off";
  }
  const folderPathRaw = String(source.folderPath || "").trim();
  const folderPath = typeof nodeGraphAudioPlayerLibraryStoredFolderPath === "function"
    ? nodeGraphAudioPlayerLibraryStoredFolderPath(folderPathRaw)
    : ((/^[a-zA-Z]:[\\/]/.test(folderPathRaw) || folderPathRaw.startsWith("/") || folderPathRaw.startsWith("\\\\"))
      ? folderPathRaw
      : "");
  const folderDive = source.folderDive !== false && source.folderDive !== "false" && source.folderDive !== 0;
  const removeAfterPlay = source.removeAfterPlay === true || source.removeAfterPlay === "true" || source.removeAfterPlay === 1;
  const formats = typeof nodeGraphAudioPlayerLibraryNormalizeFormats === "function"
    ? nodeGraphAudioPlayerLibraryNormalizeFormats(source.formats)
    : (source.formats && typeof source.formats === "object" ? source.formats : {});
  const used = Array.isArray(source.used)
    ? source.used.map((path) => String(path || "").trim()).filter(Boolean).slice(0, 10000)
    : [];
  const next = {
    face,
    folderDive,
    folderPath,
    formats,
    index,
    items,
    loopMode,
    played: hasQueues ? played : items.slice(0, index),
    playing: hasQueues ? (playingList[0] || null) : (items[index] || null),
    playNext: playNextList[0] || null,
    removeAfterPlay,
    selectedIndex,
    shuffle,
    unplayed: hasQueues ? unplayed : items.slice(index + 1),
    used,
  };
  return nodeGraphAudioPlayerPlaylistRebuildItems(next);
}

const nodeGraphAudioPlayerPlaylistFaces = Object.freeze(["wave", "waveplay", "pl", "playinfo", "vsxy", "vslr"]);

function nodeGraphAudioPlayerPlaylistNormalizeFace(value) {
  const raw = String(value || "wave").trim().toLowerCase();
  if (raw === "pl" || raw === "playlist") {
    return "pl";
  }
  if (raw === "playinfo" || raw === "play-info" || raw === "info") {
    return "playinfo";
  }
  if (raw === "wavplay" || raw === "waveplay" || raw === "wav-play" || raw === "wave-play") {
    return "waveplay";
  }
  if (raw === "vsxy" || raw === "xy") {
    return "vsxy";
  }
  if (raw === "vslr" || raw === "lr") {
    return "vslr";
  }
  return "wave";
}

function nodeGraphAudioPlayerFaceIsWave(sectionOrFace) {
  const face = typeof sectionOrFace === "string"
    ? sectionOrFace
    : (sectionOrFace?.dataset?.musicPlayerFace || "wave");
  const normalized = nodeGraphAudioPlayerPlaylistNormalizeFace(face);
  return normalized === "wave" || normalized === "waveplay";
}

function nodeGraphAudioPlayerFaceShowsPlaylist(sectionOrFace) {
  const face = typeof sectionOrFace === "string"
    ? sectionOrFace
    : (sectionOrFace?.dataset?.musicPlayerFace || "wave");
  const normalized = nodeGraphAudioPlayerPlaylistNormalizeFace(face);
  return normalized === "pl";
}

function nodeGraphAudioPlayerFaceShowsPlayinfo(sectionOrFace) {
  const face = typeof sectionOrFace === "string"
    ? sectionOrFace
    : (sectionOrFace?.dataset?.musicPlayerFace || "wave");
  return nodeGraphAudioPlayerPlaylistNormalizeFace(face) === "playinfo";
}

const nodeGraphAudioPlayerPlaylistReady = new WeakSet();

function nodeGraphAudioPlayerPlaylistForNode(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return nodeGraphAudioPlayerPlaylistNormalize(null);
  }
  const existing = node.playlist;
  if (existing && nodeGraphAudioPlayerPlaylistReady.has(existing) && Array.isArray(existing.items)) {
    return nodeGraphAudioPlayerPlaylistEnsureQueues(existing);
  }
  const normalized = nodeGraphAudioPlayerPlaylistNormalize(existing);
  node.playlist = normalized;
  nodeGraphAudioPlayerPlaylistReady.add(normalized);
  if (
    typeof nodeGraphAudioPlayerLibraryCatalog === "function"
    && !nodeGraphAudioPlayerLibraryCatalog(node.id).length
    && normalized.items.length
    && typeof nodeGraphAudioPlayerLibrarySetCatalog === "function"
  ) {
    nodeGraphAudioPlayerLibrarySetCatalog(node.id, normalized.items);
  }
  return normalized;
}

function nodeGraphAudioPlayerPlaylistEstimateBytes(sampleId) {
  const id = normalizeNodeGraphSampleId
    ? normalizeNodeGraphSampleId(sampleId)
    : String(sampleId || "").trim();
  const buf = id ? nodeGraphMvp?.sampleBuffers?.get?.(id) : null;
  if (!buf) {
    return { bytes: 0, frames: 0, sampleRate: 0, channels: 0, loaded: false };
  }
  const channelData = buf.channelData || [];
  let frames = Math.max(0, Math.round(nodeGraphFiniteNumber(buf.frames)));
  let channels = Math.max(0, Math.round(nodeGraphFiniteNumber(buf.channels, nodeGraphFiniteNumber(channelData.length, 0))));
  if (!frames && channelData[0]?.length) {
    frames = channelData[0].length;
  }
  if (!channels && buf.samples?.length) {
    channels = 1;
    frames = frames || buf.samples.length;
  }
  if (!channels) {
    channels = channelData.length || 1;
  }
  // Float32 samples in RAM (decoded).
  let samples = 0;
  if (channelData.length) {
    for (const ch of channelData) {
      samples += ch?.length || 0;
    }
  } else {
    samples = frames * channels;
  }
  return {
    bytes: samples * 4,
    frames,
    sampleRate: Math.max(0, Math.round(nodeGraphFiniteNumber(buf.sampleRate))),
    channels,
    loaded: true,
  };
}

function nodeGraphAudioPlayerPlaylistFormatBytes(bytes) {
  const n = Math.max(0, nodeGraphFiniteNumber(bytes));
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  if (n < 1024 * 1024 * 1024) {
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function nodeGraphAudioPlayerPlaylistRamSummary(nodeId) {
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  let bytes = 0;
  let frames = 0;
  let loaded = 0;
  for (const item of pl.items) {
    const est = nodeGraphAudioPlayerPlaylistEstimateBytes(item.sampleId);
    bytes += est.bytes || item.bytes || 0;
    frames += est.frames || item.frames || 0;
    if (est.loaded) {
      loaded += 1;
    }
  }
  return {
    bytes,
    frames,
    tracks: pl.items.length,
    loaded,
    label: `${pl.items.length} track${pl.items.length === 1 ? "" : "s"}`,
    hog: bytes >= 64 * 1024 * 1024,
  };
}

function nodeGraphAudioPlayerPlaylistCardForPersist(item) {
  if (!item) {
    return null;
  }
  return {
    bytes: item.bytes || 0,
    fileKey: item.fileKey || "",
    id: item.id,
    listNumber: item.listNumber || 0,
    name: item.name,
    path: item.path || "",
  };
}

/** Play history queues + folder location. No decoded audio. */
function nodeGraphAudioPlayerPlaylistForPersist(raw = null) {
  const n = nodeGraphAudioPlayerPlaylistEnsureQueues(nodeGraphAudioPlayerPlaylistNormalize(raw));
  return {
    face: n.face,
    folderDive: n.folderDive,
    folderPath: n.folderPath,
    formats: n.formats,
    index: n.index,
    items: (n.items || []).map(nodeGraphAudioPlayerPlaylistCardForPersist).filter(Boolean),
    loopMode: n.loopMode,
    played: (n.played || []).map(nodeGraphAudioPlayerPlaylistCardForPersist).filter(Boolean),
    playing: nodeGraphAudioPlayerPlaylistCardForPersist(n.playing),
    playNext: nodeGraphAudioPlayerPlaylistCardForPersist(n.playNext),
    removeAfterPlay: n.removeAfterPlay,
    selectedIndex: n.selectedIndex,
    shuffle: n.shuffle,
    unplayed: (n.unplayed || []).map(nodeGraphAudioPlayerPlaylistCardForPersist).filter(Boolean),
  };
}

function nodeGraphAudioPlayerPlaylistShuffleArray(list) {
  const items = Array.isArray(list) ? list.slice() : [];
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = items[i];
    items[i] = items[j];
    items[j] = swap;
  }
  return items;
}

function nodeGraphAudioPlayerPlaylistPullItem(pl, item) {
  const key = nodeGraphAudioPlayerPlaylistItemKey(item);
  if (!key || !pl) {
    return;
  }
  pl.played = (pl.played || []).filter((entry) => nodeGraphAudioPlayerPlaylistItemKey(entry) !== key);
  pl.unplayed = (pl.unplayed || []).filter((entry) => nodeGraphAudioPlayerPlaylistItemKey(entry) !== key);
  if (pl.playing && nodeGraphAudioPlayerPlaylistItemKey(pl.playing) === key) {
    pl.playing = null;
  }
}

function nodeGraphAudioPlayerPlaylistAdoptPlaying(pl, item, { retireCurrent = true } = {}) {
  if (!pl || !item) {
    return pl;
  }
  const key = nodeGraphAudioPlayerPlaylistItemKey(item);
  if (pl.playing && nodeGraphAudioPlayerPlaylistItemKey(pl.playing) === key) {
    return nodeGraphAudioPlayerPlaylistSyncQueues(pl);
  }
  nodeGraphAudioPlayerPlaylistPullItem(pl, item);
  if (retireCurrent && pl.playing) {
    pl.played = [...(pl.played || []), pl.playing];
  }
  pl.playing = item;
  return nodeGraphAudioPlayerPlaylistSyncQueues(pl);
}

function nodeGraphAudioPlayerPlaylistResetHistory(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return;
  }
  const pl = nodeGraphAudioPlayerPlaylistEnsureQueues(nodeGraphAudioPlayerPlaylistForNode(nodeId));
  pl.played = [];
  nodeGraphAudioPlayerPlaylistSyncQueues(pl);
  node.playlist = pl;
  if (typeof setNodeGraphSampleStatus === "function") {
    setNodeGraphSampleStatus(nodeId, "play history reset");
  }
  nodeGraphAudioPlayerPlaylistRefreshUi(nodeId);
  nodeGraphAudioPlayerPlaylistPersist(nodeId);
}

function nodeGraphAudioPlayerPlaylistPersist(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return;
  }
  if (typeof saveNodeGraphWorkingPatchToUserSettings === "function") {
    saveNodeGraphWorkingPatchToUserSettings();
  } else if (typeof markNodeGraphRenderPending === "function") {
    markNodeGraphRenderPending();
  }
}

/** Start (or unstick) the sandbox AudioContext from a user gesture. */
function nodeGraphAudioPlayerEnsureLiveOutput() {
  if (typeof nodeGraphLiveEnsureContextFromGesture === "function") {
    nodeGraphLiveEnsureContextFromGesture();
  }
  if (nodeGraphMvp?.live?.context?.state === "running" && nodeGraphMvp.live.node) {
    return Promise.resolve();
  }
  if (typeof nodeGraphExternalStartLiveOutput === "function") {
    nodeGraphExternalStartLiveOutput();
  }
  return Promise.resolve();
}

/** Playmode base 0…5. Writes the param (modulation still stacks on top). */
function nodeGraphAudioPlayerWriteTransport(nodeId, mode, { record = false } = {}) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return;
  }
  const next = Math.max(0, Math.min(5, Math.round(nodeGraphFiniteNumber(mode))));
  if (next >= 3) {
    void nodeGraphAudioPlayerEnsureLiveOutput();
  }
  // Before the slider update below, so its echo through the slider sync is not a new gesture.
  nodeGraphAudioPlayerTransportGestureLast.set(String(nodeId), next);
  node.params = { ...(node.params || {}), transport: String(next) };
  const slider = document.querySelector(
    `.dsp-node[data-node="${CSS.escape(String(nodeId))}"] input[data-param="transport"]`,
  );
  if (slider) {
    if (typeof setNodeSliderValue === "function") {
      setNodeSliderValue(slider, next, { interaction: "program" });
    } else {
      slider.value = String(next);
      if (typeof syncNodeSliderReadout === "function") {
        syncNodeSliderReadout(slider);
      }
    }
  }
  if (typeof scheduleNodeGraphLiveParameterSync === "function") {
    scheduleNodeGraphLiveParameterSync();
  }
  if (record && typeof saveNodeGraphWorkingPatchToUserSettings === "function") {
    saveNodeGraphWorkingPatchToUserSettings();
  }
  nodeGraphAudioPlayerPlaylistSyncTransport(nodeId);
  if (next >= 3) {
    const section = document.querySelector(
      `.node-sample-waveform-display[data-node="${CSS.escape(String(nodeId))}"]`,
    );
    if (section && typeof nodeGraphSampleWaveformEnsureLoop === "function") {
      nodeGraphSampleWaveformEnsureLoop(section);
    }
  }
}

function nodeGraphAudioPlayerTransportBase(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const n = Math.round(Number(node?.params?.transport));
  return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 1;
}

/** Slider / user Playmode: bind+decode like the Play button when entering 3–5. */
// The slider value IS the mode (already in params when this runs): Stop / Pause / Off apply as
// is. Only acts when the value changes; moving between playing modes never restarts the track.
const nodeGraphAudioPlayerTransportGestureLast = new Map();

function nodeGraphAudioPlayerApplyTransportGesture(nodeId, mode) {
  const next = Math.max(0, Math.min(5, Math.round(nodeGraphFiniteNumber(mode))));
  const id = String(nodeId || "");
  const prev = nodeGraphAudioPlayerTransportGestureLast.get(id);
  nodeGraphAudioPlayerTransportGestureLast.set(id, next);
  if (prev === next) {
    return;
  }
  // Transport buttons follow the slider (UI only, no transport write).
  nodeGraphAudioPlayerPlaylistSyncTransport(nodeId);
  if (next < 3) {
    return;
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return;
  }
  const sid = node.sample?.id;
  const hasBuf = Boolean(sid && nodeGraphMvp?.sampleBuffers?.get?.(sid));
  const reason = String(nodeGraphMvp?.sampleRuntimeStatus?.get?.(nodeId)?.reason || "").trim().toLowerCase();
  const ctxRunning = nodeGraphMvp?.live?.context?.state === "running";
  // Bound + running: the param change itself drives the engine. From Stop ("engine stopped")
  // the engine sees Stop -> playing mode and restarts the track, so nothing else may write the
  // transport (PlaylistPlay's done-reset would write Stop over the slider). Only a finished
  // track ("engine complete", still on a playing mode) needs PlaylistPlay's restart.
  if (hasBuf && ctxRunning && reason !== "engine complete") {
    void nodeGraphAudioPlayerEnsureLiveOutput();
    return;
  }
  // A load started by an earlier playing mode is in flight: it applies the slider's mode when it lands.
  if (prev >= 3 && nodeGraphAudioPlayerPlaylistLoadBusy.get(id)) {
    return;
  }
  if (typeof nodeGraphAudioPlayerPlaylistPlay === "function") {
    nodeGraphAudioPlayerPlaylistPlay(nodeId, { transport: next });
  }
}

function nodeGraphAudioPlayerPlaylistPlayModeForLoop(loopMode) {
  if (loopMode === "one") {
    return 3;
  }
  if (loopMode === "all") {
    return 5;
  }
  return 4;
}

function nodeGraphAudioPlayerPlaylistUnbindCurrentSample(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return;
  }
  delete node.sample;
  node.samplePhase = 0;
  nodeGraphMvp?.sampleLoadErrors?.delete?.(nodeId);
  nodeGraphMvp?.sampleRuntimeStatus?.delete?.(nodeId);
  nodeGraphMvp?.audioPlayerActualSpeeds?.delete?.(nodeId);
  if (typeof nodeGraphAudioPlayerWriteTransport === "function") {
    nodeGraphAudioPlayerWriteTransport(nodeId, 0);
  }
  if (typeof syncNodeGraphSampleDisplayForNode === "function") {
    syncNodeGraphSampleDisplayForNode(nodeId);
  }
  if (typeof scheduleNodeGraphLivePlanSync === "function") {
    scheduleNodeGraphLivePlanSync("plan");
  }
}

function nodeGraphAudioPlayerPlaylistClear(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return;
  }
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  pl.items = [];
  pl.played = [];
  pl.playing = null;
  pl.playNext = null;
  pl.unplayed = [];
  pl.index = 0;
  pl.selectedIndex = 0;
  pl.used = [];
  node.playlist = pl;
  if (typeof nodeGraphAudioPlayerLibraryCatalogs === "function") {
    nodeGraphAudioPlayerLibraryCatalogs().delete(String(nodeId));
  }
  nodeGraphAudioPlayerPlaylistUnbindCurrentSample(nodeId);
  nodeGraphAudioPlayerPlaylistRefreshUi(nodeId);
  nodeGraphAudioPlayerPlaylistPersist(nodeId);
}

function nodeGraphAudioPlayerPlaylistRemoveSelected(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return;
  }
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  if (!pl.items.length) {
    return;
  }
  const selected = Number.isInteger(pl.selectedIndex) ? pl.selectedIndex : pl.index;
  const i = Math.max(0, Math.min(pl.items.length - 1, selected));
  const removed = pl.items[i];
  pl.items.splice(i, 1);
  if (removed && nodeGraphAudioPlayerPlaylistItemKey(pl.playNext) === nodeGraphAudioPlayerPlaylistItemKey(removed)) {
    pl.playNext = null;
  }
  pl.index = Math.max(0, Math.min(pl.items.length ? pl.items.length - 1 : 0, i));
  pl.selectedIndex = pl.index;
  node.playlist = pl;
  const sid = typeof normalizeNodeGraphSampleId === "function"
    ? normalizeNodeGraphSampleId(node.sample?.id)
    : String(node.sample?.id || "").trim();
  if (!pl.items.length) {
    nodeGraphAudioPlayerPlaylistUnbindCurrentSample(nodeId);
  } else if (removed && sid && removed.sampleId === sid) {
    nodeGraphAudioPlayerPlaylistPlayIndex(nodeId, pl.index, { autoplay: false });
  }
  nodeGraphAudioPlayerPlaylistRefreshUi(nodeId);
  nodeGraphAudioPlayerPlaylistPersist(nodeId);
}

function nodeGraphAudioPlayerPlaylistToggleShuffle(nodeId) {
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  pl.shuffle = !pl.shuffle;
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (node) {
    node.playlist = pl;
  }
  if (typeof setNodeGraphSampleStatus === "function") {
    setNodeGraphSampleStatus(nodeId, pl.shuffle ? "shuffle on — next track is random from unplayed" : "shuffle off — next track is the next unplayed");
  }
  nodeGraphAudioPlayerPlaylistPersist(nodeId);
  nodeGraphAudioPlayerPlaylistSyncTransport(nodeId);
}

function nodeGraphAudioPlayerPlaylistCycleLoop(nodeId) {
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  const order = ["off", "one", "all"];
  const i = order.indexOf(pl.loopMode);
  pl.loopMode = order[(i + 1) % order.length];
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (node) {
    node.playlist = pl;
  }
  nodeGraphAudioPlayerPlaylistPersist(nodeId);
  const transport = nodeGraphAudioPlayerTransportBase(nodeId);
  if (transport >= 3) {
    nodeGraphAudioPlayerWriteTransport(nodeId, nodeGraphAudioPlayerPlaylistPlayModeForLoop(pl.loopMode));
    return;
  }
  nodeGraphAudioPlayerPlaylistSyncTransport(nodeId);
}

function nodeGraphAudioPlayerPlaylistIsAudible(nodeId) {
  return nodeGraphAudioPlayerTransportBase(nodeId) >= 3;
}

function nodeGraphAudioPlayerPlaylistStop(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return;
  }
  nodeGraphAudioPlayerWriteTransport(nodeId, 1);
  node.samplePhase = 0;
  if (!node.params || typeof node.params !== "object") {
    node.params = {};
  }
  node.params.playlistScrub = "0";
  node.samplePhaseSeek = Math.round(nodeGraphFiniteNumber(node.samplePhaseSeek, 0)) + 1;
  if (typeof rememberNodeGraphAudioPlayerSamplePhase === "function") {
    rememberNodeGraphAudioPlayerSamplePhase(nodeId, 0);
  }
  nodeGraphAudioPlayerPlaylistSeekBase.delete(nodeId);
  nodeGraphAudioPlayerPlaylistSeekAbsolute(nodeId, 0, { record: false });
  if (typeof scheduleNodeGraphLiveParameterSync === "function") {
    scheduleNodeGraphLiveParameterSync();
  }
  if (typeof flushNodeGraphLivePlanSync === "function") {
    flushNodeGraphLivePlanSync();
  }
}

function nodeGraphAudioPlayerPlaylistSelectDelta(nodeId, dir) {
  const pl = nodeGraphAudioPlayerPlaylistEnsureQueues(nodeGraphAudioPlayerPlaylistForNode(nodeId));
  const n = pl.items.length;
  if (!n) {
    return;
  }
  const from = Number.isInteger(pl.selectedIndex) ? pl.selectedIndex : pl.index;
  let next = from + dir;
  if (pl.loopMode === "all") {
    next = ((next % n) + n) % n;
  } else {
    next = Math.max(0, Math.min(n - 1, next));
  }
  pl.selectedIndex = next;
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (node) {
    node.playlist = pl;
  }
  nodeGraphAudioPlayerPlaylistRefreshUi(nodeId);
  nodeGraphAudioPlayerPlaylistPersist(nodeId);
}

function nodeGraphAudioPlayerPlaylistPlay(nodeId, options = {}) {
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  const i = Number.isInteger(pl.selectedIndex) ? pl.selectedIndex : pl.index;
  const item = pl.items[i] || pl.items[pl.index] || pl.items[0];
  if (!item) {
    if (typeof nodeGraphAudioPlayerLog === "function") {
      nodeGraphAudioPlayerLog("FAIL", "Play: playlist empty", { nodeId });
    }
    if (typeof setNodeInteractionHelp === "function") {
      setNodeInteractionHelp("Load a folder first, then Play.");
    }
    return;
  }
  const reason = String(nodeGraphMvp?.sampleRuntimeStatus?.get?.(nodeId)?.reason || "").trim().toLowerCase();
  const transport = nodeGraphAudioPlayerTransportBase(nodeId);
  const ctxRunning = nodeGraphMvp?.live?.context?.state === "running";
  const wantTransport = Math.round(nodeGraphFiniteNumber(options.transport, NaN));
  if (typeof nodeGraphAudioPlayerPlaylistDebug === "function") {
    nodeGraphAudioPlayerPlaylistDebug(nodeId, "play-button", {
      index: pl.items[i] ? i : 0,
      name: item.name || "",
      transport,
      wantTransport,
      reason,
      ctxRunning,
    });
  }
  void nodeGraphAudioPlayerEnsureLiveOutput();
  // After a file ends the engine stays on Play (4) with completed=true.
  // Writing 4 again does not clear completed — Stop then Play does.
  // Same reset when audio never started (embed: transport already Play, context dead).
  // Only a finished / stopped engine gets the Stop write. Never rewrite the user's Playmode while
  // audio or the track is still coming up: PlayIndex applies the mode once the track lands.
  const engineDone = reason === "engine complete" || reason === "engine stopped";
  if (engineDone || transport <= 1 || !ctxRunning) {
    const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
    if (node) {
      node.samplePhase = 0;
      node.samplePhaseSeek = Math.round(nodeGraphFiniteNumber(node.samplePhaseSeek, 0)) + 1;
    }
    if (engineDone && transport !== 1 && typeof nodeGraphAudioPlayerWriteTransport === "function") {
      nodeGraphAudioPlayerWriteTransport(nodeId, 1);
    }
  }
  const playOpts = { autoplay: true };
  if (Number.isFinite(wantTransport) && wantTransport >= 3 && wantTransport <= 5) {
    playOpts.transport = wantTransport;
  }
  const result = nodeGraphAudioPlayerPlaylistPlayIndex(nodeId, pl.items[i] ? i : 0, playOpts);
  if (result && typeof result.catch === "function") {
    result.catch((error) => {
      if (typeof nodeGraphAudioPlayerLog === "function") {
        nodeGraphAudioPlayerLog("FAIL", String(error?.message || error || "play failed"), {
          nodeId,
          name: item.name || "",
        });
      }
    });
  }
}

function nodeGraphAudioPlayerPlaylistPause(nodeId) {
  const transport = nodeGraphAudioPlayerTransportBase(nodeId);
  if (transport < 3) {
    return;
  }
  nodeGraphAudioPlayerWriteTransport(nodeId, 2);
}

function nodeGraphAudioPlayerPlaylistTogglePlayPause(nodeId) {
  const transport = nodeGraphAudioPlayerTransportBase(nodeId);
  if (transport >= 3) {
    nodeGraphAudioPlayerPlaylistPause(nodeId);
    return;
  }
  nodeGraphAudioPlayerPlaylistPlay(nodeId);
}

function nodeGraphAudioPlayerPlaylistPickNeighbor(pl, from, dir) {
  const n = pl.items.length;
  if (n <= 0) {
    return -1;
  }
  return from + dir;
}

function nodeGraphAudioPlayerPlaylistCurrentSampleRef(node) {
  const sampleId = typeof normalizeNodeGraphSampleId === "function"
    ? normalizeNodeGraphSampleId(node?.sample?.id)
    : String(node?.sample?.id || "").trim();
  if (!sampleId) {
    return null;
  }
  const samples = Array.isArray(nodeGraphMvp?.patch?.samples) ? nodeGraphMvp.patch.samples : [];
  const stored = samples.find((entry) => {
    const id = typeof normalizeNodeGraphSampleId === "function"
      ? normalizeNodeGraphSampleId(entry?.id)
      : String(entry?.id || "").trim();
    return id === sampleId;
  });
  const name = String(
    stored?.name
    || stored?.sourceName
    || node?.sample?.name
    || (typeof nodeGraphSampleNameForNode === "function" ? nodeGraphSampleNameForNode(node.id) : "")
    || sampleId,
  ).trim();
  return { id: sampleId, name: name || sampleId };
}

/** If the module is playing / holding a sample, that track belongs on the playlist. */
function nodeGraphAudioPlayerPlaylistEnsureCurrentSample(nodeId, options = {}) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return null;
  }
  const ref = nodeGraphAudioPlayerPlaylistCurrentSampleRef(node);
  if (!ref) {
    return null;
  }
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  let existing = nodeGraphAudioPlayerPlaylistFindItemForSample(pl, ref.id);
  if (!existing) {
    const refName = nodeGraphAudioPlayerPlaylistFileName({ name: ref.name });
    existing = pl.items.find((item) => (
      !item.sampleId && nodeGraphAudioPlayerPlaylistFileName(item) === refName
    ));
  }
  if (existing) {
    existing.sampleId = ref.id;
    node.playlist = pl;
    return existing;
  }
  if ((pl.items || []).some((item) => item.path || item.fileKey)) {
    return null;
  }
  return nodeGraphAudioPlayerPlaylistAppendSample(nodeId, ref, options);
}

/** Append a loaded sample to the playlist (dedupe by sampleId). */
function nodeGraphAudioPlayerPlaylistAppendSample(nodeId, sampleRef = {}, options = {}) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return null;
  }
  const sampleId = normalizeNodeGraphSampleId
    ? normalizeNodeGraphSampleId(sampleRef.id || sampleRef.sampleId)
    : String(sampleRef.id || sampleRef.sampleId || "").trim();
  if (!sampleId) {
    return null;
  }
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  const existingItem = nodeGraphAudioPlayerPlaylistFindItemForSample(pl, sampleId);
  const existing = existingItem ? pl.items.indexOf(existingItem) : -1;
  const est = nodeGraphAudioPlayerPlaylistEstimateBytes(sampleId);
  if (existing >= 0) {
    const cur = pl.items[existing];
    cur.sampleId = sampleId;
    cur.bytes = est.bytes || cur.bytes;
    cur.frames = est.frames || cur.frames;
    cur.sampleRate = est.sampleRate || cur.sampleRate;
    cur.channels = est.channels || cur.channels;
    if (!cur.name) {
      cur.name = String(sampleRef.name || sampleRef.sourceName || sampleId).trim().slice(0, 160) || sampleId;
    }
    pl.index = existing;
    node.playlist = pl;
    if (options.persist !== false) {
      nodeGraphAudioPlayerPlaylistPersist(nodeId);
    }
    if (options.refresh !== false) {
      nodeGraphAudioPlayerPlaylistRefreshUi(nodeId);
    }
    return cur;
  }
  const entry = {
    id: `pl-${Date.now().toString(36)}-${sampleId.slice(-8)}`,
    name: String(sampleRef.name || sampleRef.sourceName || sampleId).trim().slice(0, 160) || sampleId,
    sampleId,
    bytes: est.bytes,
    frames: est.frames,
    sampleRate: est.sampleRate,
    channels: est.channels,
  };
  pl.items.push(entry);
  pl.index = pl.items.length - 1;
  node.playlist = pl;
  if (options.persist !== false) {
    nodeGraphAudioPlayerPlaylistPersist(nodeId);
  }
  if (options.refresh !== false) {
    nodeGraphAudioPlayerPlaylistRefreshUi(nodeId);
  }
  return entry;
}

function nodeGraphAudioPlayerPlaylistSetFace(nodeId, face) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return;
  }
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  pl.face = nodeGraphAudioPlayerPlaylistNormalizeFace(face);
  node.playlist = pl;
  nodeGraphAudioPlayerPlaylistApplyFace(nodeId);
  nodeGraphAudioPlayerPlaylistPersist(nodeId);
}

/**
 * Return to the waveform face for the sample currently loaded in the player
 * (re-syncs playlist index if the list selection had drifted).
 */
function nodeGraphAudioPlayerPlaylistGoToWave(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return;
  }
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  const sid = normalizeNodeGraphSampleId
    ? normalizeNodeGraphSampleId(node.sample?.id)
    : String(node.sample?.id || "").trim();
  if (sid) {
    const i = pl.items.findIndex((item) => item.sampleId === sid);
    if (i >= 0) {
      pl.index = i;
    }
  }
  pl.face = "wave";
  node.playlist = pl;
  nodeGraphAudioPlayerPlaylistApplyFace(nodeId);
  nodeGraphAudioPlayerPlaylistPersist(nodeId);
}

function nodeGraphAudioPlayerPlaylistCreateTransport(nodeId) {
  const bar = document.createElement("div");
  bar.className = "node-music-player-pl-transport";
  bar.dataset.musicPlayerTransport = "true";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Playlist transport");
  const specs = [
    ["prev", "◁", "Previous track"],
    ["next", "▷", "Next track"],
    ["stop", "⏹", "Stop"],
    ["play", "▶", "Play"],
    ["pause", "⏸", "Pause"],
    ["loop", "↪️", "Loop off"],
    ["shuffle", "🔀", "Shuffle off"],
  ];
  for (const [action, label, title] of specs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "node-music-player-pl-transport-btn";
    btn.dataset.musicPlayerTransport = action;
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      nodeGraphAudioPlayerPlaylistTransportAction(nodeId, action);
    });
    btn.addEventListener("pointerdown", (event) => event.stopPropagation());
    bar.append(btn);
  }
  return bar;
}

function nodeGraphAudioPlayerPlaylistTransportAction(nodeId, action) {
  if (action === "prev") {
    if (nodeGraphAudioPlayerPlaylistIsAudible(nodeId)) {
      nodeGraphAudioPlayerPlaylistPlayPrev(nodeId);
    } else {
      nodeGraphAudioPlayerPlaylistSelectDelta(nodeId, -1);
    }
    return;
  }
  if (action === "next") {
    if (nodeGraphAudioPlayerPlaylistIsAudible(nodeId)) {
      nodeGraphAudioPlayerPlaylistPlayNext(nodeId);
    } else {
      nodeGraphAudioPlayerPlaylistSelectDelta(nodeId, 1);
    }
    return;
  }
  if (action === "stop") {
    nodeGraphAudioPlayerPlaylistStop(nodeId);
    return;
  }
  if (action === "play") {
    nodeGraphAudioPlayerPlaylistPlay(nodeId);
    return;
  }
  if (action === "pause") {
    nodeGraphAudioPlayerPlaylistPause(nodeId);
    return;
  }
  if (action === "loop") {
    nodeGraphAudioPlayerPlaylistCycleLoop(nodeId);
    return;
  }
  if (action === "shuffle") {
    nodeGraphAudioPlayerPlaylistToggleShuffle(nodeId);
    return;
  }
  if (action === "dive") {
    if (typeof nodeGraphAudioPlayerLibraryToggleDive === "function") {
      nodeGraphAudioPlayerLibraryToggleDive(nodeId);
    }
  }
}

function nodeGraphAudioPlayerPlaylistSyncTransport(nodeId) {
  const section = document.querySelector(
    `.node-sample-waveform-display[data-node="${CSS.escape(String(nodeId || ""))}"]`,
  );
  const bar = section?.querySelector?.("[data-music-player-transport]");
  if (!bar) {
    return;
  }
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  const transport = nodeGraphAudioPlayerTransportBase(nodeId);
  const loopBtn = bar.querySelector("[data-music-player-transport='loop']");
  if (loopBtn) {
    const loop = transport === 3 ? "one" : transport === 5 ? "all" : pl.loopMode;
    loopBtn.textContent = loop === "one" ? "🔂" : loop === "all" ? "🔁" : "↪️";
    loopBtn.title = loop === "one" ? "Loop single" : loop === "all" ? "Loop all" : "Loop off";
    loopBtn.setAttribute("aria-label", loopBtn.title);
    loopBtn.classList.toggle("is-active", loop !== "off");
  }
  const playBtn = bar.querySelector("[data-music-player-transport='play']");
  if (playBtn) {
    playBtn.classList.toggle("is-active", transport >= 3);
  }
  const pauseBtn = bar.querySelector("[data-music-player-transport='pause']");
  if (pauseBtn) {
    pauseBtn.classList.toggle("is-active", transport === 2);
  }
  const stopBtn = bar.querySelector("[data-music-player-transport='stop']");
  if (stopBtn) {
    stopBtn.classList.toggle("is-active", transport === 1);
  }
  const shuffleBtn = bar.querySelector("[data-music-player-transport='shuffle']");
  if (shuffleBtn) {
    const on = Boolean(pl.shuffle);
    shuffleBtn.classList.toggle("is-active", on);
    shuffleBtn.setAttribute("aria-pressed", on ? "true" : "false");
    shuffleBtn.title = on ? "Shuffle on" : "Shuffle off";
    shuffleBtn.setAttribute("aria-label", shuffleBtn.title);
  }
}

const nodeGraphAudioPlayerPlaylistFacesSpec = Object.freeze([
  ["wave", "wave", "Wave"],
  ["waveplay", "waveplay", "Waveplay"],
  ["pl", "playlist", "Playlist"],
  ["playinfo", "playinfo", "Playinfo"],
  ["vsxy", "XY", "XY"],
  ["vslr", "LR", "LR"],
]);

function nodeGraphAudioPlayerPlaylistEnsureFaceBar(section, nodeId) {
  section?.querySelectorAll?.(".node-music-player-face-bar").forEach((el) => el.remove());
  return null;
}

function nodeGraphAudioPlayerPlaylistEnsurePlayinfoPage(section) {
  if (!section) {
    return null;
  }
  let page = section.querySelector("[data-music-player-page='playinfo']");
  if (!page) {
    page = document.createElement("div");
    page.className = "node-music-player-page node-music-player-page-playinfo";
    page.dataset.musicPlayerPage = "playinfo";
    page.hidden = true;
    section.append(page);
  }
  if (!page.querySelector("[data-music-player-ram-panel]")) {
    let panel = section.querySelector("[data-music-player-ram-panel]");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "node-music-player-pl-ram-panel";
      panel.dataset.musicPlayerRamPanel = "true";
      const body = document.createElement("div");
      body.className = "node-music-player-pl-ram-body";
      body.dataset.musicPlayerRamBody = "true";
      panel.append(body);
    }
    page.append(panel);
  }
  return page;
}

function nodeGraphAudioPlayerPlaylistEnsureWaveplayPage(section) {
  if (!section) {
    return null;
  }
  let page = section.querySelector("[data-music-player-page='waveplay']")
    || section.querySelector("[data-music-player-page='wavplay']");
  if (page) {
    page.className = "node-music-player-page node-music-player-page-waveplay";
    page.dataset.musicPlayerPage = "waveplay";
    if (!page.querySelector("[data-music-player-wave-host]")) {
      const host = document.createElement("div");
      host.className = "node-music-player-waveplay-wave";
      host.dataset.musicPlayerWaveHost = "true";
      page.prepend(host);
    }
    let nowSong = page.querySelector("[data-music-player-now-song]");
    if (!nowSong) {
      page.append(nodeGraphAudioPlayerPlaylistCreateNowSong(section.dataset?.node || ""));
    }
    nodeGraphAudioPlayerPlaylistBindWaveplayDblClick(page, section.dataset?.node || "");
    return page;
  }
  page = document.createElement("div");
  page.className = "node-music-player-page node-music-player-page-waveplay";
  page.dataset.musicPlayerPage = "waveplay";
  page.hidden = true;
  const host = document.createElement("div");
  host.className = "node-music-player-waveplay-wave";
  host.dataset.musicPlayerWaveHost = "true";
  page.append(host);
  page.append(nodeGraphAudioPlayerPlaylistCreateNowSong(section.dataset?.node || ""));
  nodeGraphAudioPlayerPlaylistBindWaveplayDblClick(page, section.dataset?.node || "");
  section.append(page);
  return page;
}

function nodeGraphAudioPlayerPlaylistBindWaveplayDblClick(page, nodeId) {
  if (!page || page.dataset.waveplayDblBound === "1") {
    return;
  }
  page.dataset.waveplayDblBound = "1";
  page.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const id = String(nodeId || page.closest?.("[data-node]")?.dataset?.node || "");
    if (id) {
      nodeGraphAudioPlayerPlaylistReplayCurrent(id);
    }
  });
}

function nodeGraphAudioPlayerPlaylistEnsureWavplayPage(section) {
  return nodeGraphAudioPlayerPlaylistEnsureWaveplayPage(section);
}

function nodeGraphAudioPlayerPlaylistCreateNowSong(nodeId) {
  const row = document.createElement("div");
  row.className = "node-music-player-waveplay-song";
  row.dataset.musicPlayerNowSong = "true";
  const name = document.createElement("button");
  name.type = "button";
  name.className = "node-music-player-pl-name";
  name.dataset.musicPlayerNowSongName = "true";
  name.textContent = "No sample loaded";
  name.title = "Play current track";
  name.setAttribute("aria-label", "Play current track");
  name.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const id = String(nodeId || row.closest?.("[data-node]")?.dataset?.node || "");
    if (id) {
      nodeGraphAudioPlayerPlaylistReplayCurrent(id);
    }
  });
  name.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  name.addEventListener("pointerdown", (event) => event.stopPropagation());
  row.append(name);
  return row;
}

function nodeGraphAudioPlayerPlaylistSyncNowSong(nodeId) {
  const section = document.querySelector(
    `.node-sample-waveform-display[data-node="${CSS.escape(String(nodeId || ""))}"]`,
  );
  const label = section?.querySelector?.("[data-music-player-now-song-name]");
  if (!label) {
    return;
  }
  const ref = nodeGraphAudioPlayerPlaylistCurrentSampleRef(
    typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null,
  );
  const text = ref ? nodeGraphAudioPlayerPlaylistFileName(ref) : "No sample loaded";
  if (label.textContent !== text) {
    label.textContent = text;
  }
}

function nodeGraphAudioPlayerPlaylistEnsurePageBar(section, nodeId) {
  if (!section) {
    return null;
  }
  section.querySelectorAll(":scope > .node-music-player-dock").forEach((el) => el.remove());
  let bar = section.querySelector(":scope > .node-music-player-page-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "node-music-player-page-bar";
    bar.setAttribute("role", "tablist");
    bar.setAttribute("aria-label", "Music player pages");
    section.append(bar);
  }
  const existing = [...bar.querySelectorAll("[data-music-player-face]")]
    .map((btn) => `${btn.dataset.musicPlayerFace}:${btn.textContent}`)
    .join(",");
  const wanted = nodeGraphAudioPlayerPlaylistFacesSpec
    .map((entry) => `${entry[0]}:${entry[1]}`)
    .join(",");
  if (existing === wanted) {
    return bar;
  }
  bar.replaceChildren();
  for (const [face, label, title] of nodeGraphAudioPlayerPlaylistFacesSpec) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "node-music-player-page-btn";
    btn.dataset.musicPlayerFace = face;
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      nodeGraphAudioPlayerPlaylistSetFace(nodeId, face);
    });
    btn.addEventListener("pointerdown", (event) => event.stopPropagation());
    bar.append(btn);
  }
  return bar;
}

function nodeGraphAudioPlayerPlaylistPlaceShared(section, nodeId, face) {
  if (!section) {
    return;
  }
  const waveplayPage = nodeGraphAudioPlayerPlaylistEnsureWaveplayPage(section);
  const playinfoPage = nodeGraphAudioPlayerPlaylistEnsurePlayinfoPage(section);
  const wavePage = section.querySelector("[data-music-player-page='wave']");
  const plPage = section.querySelector("[data-music-player-page='pl']");
  const waveHost = waveplayPage?.querySelector("[data-music-player-wave-host]");
  const canvas = section.querySelector(".node-sample-waveform-canvas");
  const ramPanel = section.querySelector("[data-music-player-ram-panel]");
  const list = section.querySelector("[data-music-player-list]");
  let transport = section.querySelector("[data-music-player-transport]");
  if (!transport && nodeId) {
    transport = nodeGraphAudioPlayerPlaylistCreateTransport(nodeId);
  }
  if (canvas) {
    if (face === "waveplay" && waveHost && canvas.parentElement !== waveHost) {
      waveHost.append(canvas);
    } else if (face !== "waveplay" && wavePage && canvas.parentElement !== wavePage) {
      wavePage.append(canvas);
    }
  }
  if (ramPanel && playinfoPage && ramPanel.parentElement !== playinfoPage) {
    playinfoPage.append(ramPanel);
  }
  if (list && plPage && list.parentElement !== plPage) {
    plPage.append(list);
    if (nodeId) {
      nodeGraphAudioPlayerPlaylistBindListResize(list, nodeId);
    }
  }
  if (transport && plPage && transport.parentElement !== plPage) {
    plPage.append(transport);
  }
  section.querySelectorAll("[data-music-player-debug]").forEach((el) => el.remove());
}

function nodeGraphAudioPlayerPlaylistEnsureLayout(section, nodeId) {
  if (!section) {
    return;
  }
  for (const back of section.querySelectorAll("[data-music-player-back]")) {
    if (back.classList.contains("node-music-player-pl-row")) {
      continue;
    }
    back.remove();
  }
  for (const leftover of section.querySelectorAll("[data-music-player-now]")) {
    leftover.remove();
  }
  for (const leftover of section.querySelectorAll("[data-music-player-ram]")) {
    leftover.remove();
  }
  for (const head of section.querySelectorAll(".node-music-player-pl-head")) {
    if (!head.querySelector(":scope > :not([hidden])")) {
      head.remove();
    }
  }
  nodeGraphAudioPlayerPlaylistEnsureWaveplayPage(section);
  nodeGraphAudioPlayerPlaylistEnsurePlayinfoPage(section);
  nodeGraphAudioPlayerPlaylistEnsurePageBar(section, nodeId);
  const list = section.querySelector("[data-music-player-list]");
  if (list && nodeId) {
    nodeGraphAudioPlayerPlaylistBindListResize(list, nodeId);
  }
  if (nodeId) {
    const existing = section.querySelector("[data-music-player-transport]");
    if (
      existing
      && (
        !existing.querySelector("[data-music-player-transport='pause']")
        || existing.querySelector("[data-music-player-transport='dive']")
        || !existing.querySelector("[data-music-player-transport='shuffle']")
        || existing.querySelector("[data-music-player-transport='prev']")?.textContent === "prev"
      )
    ) {
      existing.remove();
    }
    if (!section.querySelector("[data-music-player-transport]")) {
      const plPage = section.querySelector("[data-music-player-page='pl']");
      if (plPage) {
        plPage.append(nodeGraphAudioPlayerPlaylistCreateTransport(nodeId));
      }
    }
  }
  nodeGraphAudioPlayerPlaylistEnsureFaceBar(section, nodeId);
  nodeGraphAudioPlayerFitSectionLabels(section);
  if (typeof nodeGraphSampleWaveformEnsureZoomControl === "function") {
    nodeGraphSampleWaveformEnsureZoomControl(section);
  }
}

function nodeGraphAudioPlayerPlaylistApplyFace(nodeId) {
  const section = document.querySelector(
    `.node-sample-waveform-display[data-node="${CSS.escape(String(nodeId || ""))}"]`,
  );
  if (!section) {
    return;
  }
  nodeGraphAudioPlayerPlaylistEnsureLayout(section, nodeId);
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  const face = nodeGraphAudioPlayerPlaylistNormalizeFace(pl.face);
  pl.face = face;
  section.dataset.musicPlayerFace = face;
  nodeGraphAudioPlayerPlaylistPlaceShared(section, nodeId, face);
  for (const page of section.querySelectorAll("[data-music-player-page]")) {
    page.hidden = page.dataset.musicPlayerPage !== face;
  }
  for (const btn of section.querySelectorAll("[data-music-player-face]")) {
    const on = btn.dataset.musicPlayerFace === face;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  nodeGraphAudioPlayerPlaylistSyncNowSong(nodeId);
  nodeGraphAudioPlayerFitSectionLabels(section);
  if (nodeGraphAudioPlayerFaceShowsPlaylist(face)) {
    nodeGraphAudioPlayerPlaylistRefreshUi(nodeId);
    nodeGraphAudioPlayerPlaylistStopScrubLoop(nodeId);
  } else if (nodeGraphAudioPlayerFaceShowsPlayinfo(face)) {
    nodeGraphAudioPlayerPlaylistStopScrubLoop(nodeId);
    nodeGraphAudioPlayerPlaylistRefreshRamDebug(nodeId);
  } else {
    nodeGraphAudioPlayerPlaylistStopScrubLoop(nodeId);
  }
  // Face switch changes which page box owns the bitmap — resync layout cache.
  if (typeof nodeGraphSampleWaveformSyncLayout === "function") {
    nodeGraphSampleWaveformSyncLayout(section, { face });
  }
  if (typeof nodeGraphSampleWaveformEnsureLoop === "function") {
    nodeGraphSampleWaveformEnsureLoop(section);
  } else if (typeof scheduleNodeGraphSampleWaveformFrame === "function") {
    scheduleNodeGraphSampleWaveformFrame(section);
  }
}

/** Write playlist scrub offset (hidden param). Does not touch ◀◀ ▶▶ / Scratch. */
function nodeGraphAudioPlayerPlaylistWritePhaseOffset(nodeId, phaseOffset, { record = false } = {}) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return;
  }
  let next = Number(phaseOffset);
  if (!Number.isFinite(next)) {
    next = 0;
  }
  if (typeof wrapNodeSliderValue === "function") {
    next = wrapNodeSliderValue(next, -1, 1);
  } else {
    next = ((((next + 1) % 2) + 2) % 2) - 1;
  }
  node.params = { ...(node.params || {}), playlistScrub: String(next) };
  if (typeof scheduleNodeGraphLiveParameterSync === "function") {
    scheduleNodeGraphLiveParameterSync();
  }
  if (record && typeof saveNodeGraphWorkingPatchToUserSettings === "function") {
    saveNodeGraphWorkingPatchToUserSettings();
  }
}

/**
 * Absolute hard seek (track change / commit): fold position into free-running
 * samplePhase, zero phaseOffset, bump samplePhaseSeek for worklet apply.
 */
function nodeGraphAudioPlayerPlaylistSeekAbsolute(nodeId, phase01, { record = false } = {}) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return;
  }
  const phase = Math.max(0, Math.min(1, nodeGraphFiniteNumber(phase01)));
  node.samplePhase = phase;
  node.samplePhaseSeek = Math.round(nodeGraphFiniteNumber(node.samplePhaseSeek, 0)) + 1;
  node.params = { ...(node.params || {}), playlistScrub: "0" };
  if (typeof rememberNodeGraphAudioPlayerSamplePhase === "function") {
    rememberNodeGraphAudioPlayerSamplePhase(nodeId, phase);
  }
  if (typeof scheduleNodeGraphLiveParameterSync === "function") {
    scheduleNodeGraphLiveParameterSync();
  }
  if (record && typeof saveNodeGraphWorkingPatchToUserSettings === "function") {
    saveNodeGraphWorkingPatchToUserSettings();
  }
}

/**
 * Playlist seeks go through the playlist phase-offset param (playlistScrub).
 * The native engine applies it live, the same param path as the knob's Bias.
 * The engine plays a free-running phase ("base"), and the playhead is
 * base + offset. Setting the offset to (desired - base) puts the playhead at
 * the desired 0..1 position. It keeps playing from there.
 * The engine reports phase a few frames late and glides the offset, so base is
 * measured once and then advanced by elapsed play time. Re-reading it mid-glide
 * (e.g. between pointerdown and pointerup of one click) would land the
 * playhead in the wrong place.
 * Do not "fold" a seek into samplePhase/samplePhaseSeek: the engine only reads
 * those on a plan rebuild (track change), so a fold snapped the playhead back
 * on release. Track change and Stop use nodeGraphAudioPlayerPlaylistSeekAbsolute.
 */
const nodeGraphAudioPlayerPlaylistSeekBase = new Map();

function nodeGraphAudioPlayerPlaylistPlaybackRate(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const transport = Math.round(nodeGraphFiniteNumber(node?.params?.transport, 0));
  if (![3, 4, 5].includes(transport)) {
    return 0;
  }
  const entry = nodeGraphMvp?.sampleBuffers?.get?.(node?.sample?.id);
  const seconds = entry?.frames > 0 ? entry.frames / Math.max(1, entry.sampleRate || 44100) : 0;
  const rate = nodeGraphFiniteNumber(node?.params?.speed, 1) + nodeGraphFiniteNumber(node?.params?.direction, 0);
  return seconds > 0 ? rate / seconds : 0;
}

function nodeGraphAudioPlayerPlaylistSeekViaOffset(nodeId, desired01) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return;
  }
  const desired = Math.max(0, Math.min(1, nodeGraphFiniteNumber(desired01)));
  const wrap01 = (v) => ((v % 1) + 1) % 1;
  const now = performance.now();
  const transport = node.params?.transport;
  const memo = nodeGraphAudioPlayerPlaylistSeekBase.get(nodeId);
  let base;
  if (memo && now - memo.t < 500 && memo.transport === transport && memo.sampleId === node.sample?.id) {
    base = wrap01(memo.base + ((now - memo.t) / 1000) * nodeGraphAudioPlayerPlaylistPlaybackRate(nodeId));
  } else {
    const actual = typeof nodeGraphSamplePhaseForNode === "function"
      ? nodeGraphSamplePhaseForNode(nodeId)
      : nodeGraphFiniteNumber(node.samplePhase);
    base = wrap01(actual - nodeGraphFiniteNumber(node.params?.playlistScrub));
  }
  nodeGraphAudioPlayerPlaylistSeekBase.set(nodeId, { base, t: now, transport, sampleId: node.sample?.id });
  let offset = desired - base;
  // Shortest wrap in -1..+1.
  if (offset > 0.5) {
    offset -= 1;
  } else if (offset <= -0.5) {
    offset += 1;
  }
  nodeGraphAudioPlayerPlaylistWritePhaseOffset(nodeId, offset, { record: false });
  if (typeof rememberNodeGraphAudioPlayerSamplePhase === "function") {
    rememberNodeGraphAudioPlayerSamplePhase(nodeId, desired);
  }
}

/**
 * Scrubber / wave-seek entry point: move the playhead to raw (0..1). While
 * dragging, call with commit: false. On release, commit: true writes the
 * final position once (and saves the working patch when record is set).
 */
function nodeGraphAudioPlayerPlaylistApplyScrub(nodeId, raw, { record = false, commit = false } = {}) {
  nodeGraphAudioPlayerPlaylistSeekViaOffset(nodeId, raw);
  if (commit && record && typeof saveNodeGraphWorkingPatchToUserSettings === "function") {
    saveNodeGraphWorkingPatchToUserSettings();
  }
}

function nodeGraphAudioPlayerPlaylistPlayIndex(nodeId, index, options = {}) {
  if (typeof nodeGraphAudioPlayerLibraryPlayIndex === "function") {
    return nodeGraphAudioPlayerLibraryPlayIndex(nodeId, index, options);
  }
}

function nodeGraphAudioPlayerPlaylistPlayingFrom(nodeId, pl) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const sid = typeof normalizeNodeGraphSampleId === "function"
    ? normalizeNodeGraphSampleId(node?.sample?.id)
    : String(node?.sample?.id || "").trim();
  const playing = sid
    ? pl.items.findIndex((item) => item.sampleId === sid)
    : pl.index;
  return playing >= 0 ? playing : pl.index;
}

/* Replaying a file from any face must retain the selected loop/play mode. */
function nodeGraphAudioPlayerPlaylistReplayCurrent(nodeId) {
  const pl = nodeGraphAudioPlayerPlaylistEnsureQueues(nodeGraphAudioPlayerPlaylistForNode(nodeId));
  const index = nodeGraphAudioPlayerPlaylistPlayingFrom(nodeId, pl);
  const result = nodeGraphAudioPlayerPlaylistPlayIndex(nodeId, index, { autoplay: true });
  if (result && typeof result.catch === "function") {
    result.catch((error) => {
      nodeGraphAudioPlayerLog("FAIL", String(error?.message || error || "play failed"), { nodeId });
    });
  }
  return result;
}

function nodeGraphAudioPlayerPlaylistPlayNext(nodeId, options = {}) {
  if (typeof nodeGraphAudioPlayerLibraryPlayNext === "function") {
    nodeGraphAudioPlayerLibraryPlayNext(nodeId, options);
  }
}

function nodeGraphAudioPlayerPlaylistPlayPrev(nodeId) {
  if (typeof nodeGraphAudioPlayerLibraryPlayPrev === "function") {
    nodeGraphAudioPlayerLibraryPlayPrev(nodeId);
  }
}

// Auto-advance: ignore leftover complete/playing from a *different* file
// than the one we asked to load. Completing the requested file must
// advance even if we never saw "engine playing" (short file / missed snapshot).
const nodeGraphAudioPlayerPlaylistAdvanceArmed = new Map();
const nodeGraphAudioPlayerPlaylistLoadBusy = new Map();
const nodeGraphAudioPlayerPlaylistLoadTarget = new Map();
const nodeGraphAudioPlayerPlaylistAdvancePending = new Map();
const nodeGraphAudioPlayerPlaylistAdvanceTimer = new Map();
const nodeGraphAudioPlayerPlaylistLastCompletedSid = new Map();
const nodeGraphAudioPlayerPlaylistScrubLoops = new Map();
const nodeGraphAudioPlayerPlaylistDebugLastSig = new Map();

function nodeGraphAudioPlayerPlaylistDebugState(nodeId, extra = {}) {
  const id = String(nodeId || "");
  const pl = typeof nodeGraphAudioPlayerPlaylistForNode === "function"
    ? nodeGraphAudioPlayerPlaylistForNode(id)
    : null;
  return {
    nodeId: id,
    armed: Boolean(nodeGraphAudioPlayerPlaylistAdvanceArmed.get(id)),
    busy: Boolean(nodeGraphAudioPlayerPlaylistLoadBusy.get(id)),
    pending: Boolean(nodeGraphAudioPlayerPlaylistAdvancePending.get(id)),
    want: nodeGraphAudioPlayerPlaylistLoadTarget.get(id) || "",
    playing: nodeGraphAudioPlayerPlaylistItemKey(pl?.playing),
    playNext: nodeGraphAudioPlayerPlaylistItemKey(pl?.playNext),
    played: Array.isArray(pl?.played) ? pl.played.length : 0,
    unplayed: Array.isArray(pl?.unplayed) ? pl.unplayed.length : 0,
    shuffle: Boolean(pl?.shuffle),
    loop: pl?.loopMode || "",
    ...extra,
  };
}

function nodeGraphAudioPlayerPlaylistDebug(nodeId, event, extra = {}) {
  const snap = nodeGraphAudioPlayerPlaylistDebugState(nodeId, { event, ...extra });
  const ring = (typeof window !== "undefined" && (window.__musicPlayerDebug || (window.__musicPlayerDebug = { events: [] })))
    || { events: [] };
  ring.events.push({ t: Date.now(), ...snap });
  if (ring.events.length > 60) {
    ring.events.shift();
  }
  ring.last = snap;
  if (typeof window !== "undefined") {
    window.dumpMusicPlayer = function dumpMusicPlayer() {
      console.table(window.__musicPlayerDebug?.events || []);
      return window.__musicPlayerDebug;
    };
  }
  const sig = `${event}|${snap.reason || ""}|${snap.armed}|${snap.busy}|${snap.want}|${snap.bound || ""}|${snap.why || ""}`;
  const throttle = String(event).includes("ignored")
    || event === "engine-playing-leftover"
    || event === "engine-playing-armed"
    || event === "engine-stopped"
    || event === "engine-paused";
  if (throttle && nodeGraphAudioPlayerPlaylistDebugLastSig.get(snap.nodeId) === sig) {
    return snap;
  }
  nodeGraphAudioPlayerPlaylistDebugLastSig.set(snap.nodeId, sig);
  if (typeof nodeGraphAudioPlayerLog === "function") {
    nodeGraphAudioPlayerLog("INFO", event, snap);
  }
  return snap;
}

function nodeGraphAudioPlayerPlaylistCancelAdvanceTimer(nodeId) {
  const id = String(nodeId || "");
  const timer = nodeGraphAudioPlayerPlaylistAdvanceTimer.get(id);
  if (timer) {
    window.clearTimeout(timer);
    nodeGraphAudioPlayerPlaylistAdvanceTimer.delete(id);
  }
}

function nodeGraphAudioPlayerPlaylistBeginLoad(nodeId) {
  const id = String(nodeId || "");
  nodeGraphAudioPlayerPlaylistCancelAdvanceTimer(id);
  nodeGraphAudioPlayerPlaylistAdvanceArmed.set(id, false);
  nodeGraphAudioPlayerPlaylistLoadBusy.set(id, true);
  nodeGraphAudioPlayerPlaylistAdvancePending.set(id, false);
  nodeGraphAudioPlayerPlaylistDebug(id, "begin-load");
}

function nodeGraphAudioPlayerPlaylistSetLoadTarget(nodeId, item) {
  const id = String(nodeId || "");
  const key = nodeGraphAudioPlayerPlaylistItemKey(item);
  if (key) {
    nodeGraphAudioPlayerPlaylistLoadTarget.set(id, key);
  } else {
    nodeGraphAudioPlayerPlaylistLoadTarget.delete(id);
  }
  nodeGraphAudioPlayerPlaylistDebug(id, "load-target", {
    name: item?.name || "",
    sampleId: item?.sampleId || "",
  });
}

function nodeGraphAudioPlayerPlaylistEndLoad(nodeId) {
  const id = String(nodeId || "");
  nodeGraphAudioPlayerPlaylistLoadBusy.set(id, false);
  nodeGraphAudioPlayerPlaylistLoadTarget.delete(id);
  nodeGraphAudioPlayerPlaylistAdvancePending.set(id, false);
  nodeGraphAudioPlayerPlaylistDebug(id, "end-load");
}

function nodeGraphAudioPlayerPlaylistAutoAdvanceBlocked(nodeId) {
  const id = String(nodeId || "");
  if (nodeGraphAudioPlayerPlaylistAdvancePending.get(id)) {
    nodeGraphAudioPlayerPlaylistAdvancePending.set(id, false);
    return false;
  }
  const blocked = Boolean(nodeGraphAudioPlayerPlaylistLoadBusy.get(id));
  if (blocked) {
    nodeGraphAudioPlayerPlaylistDebug(id, "play-next-blocked", { why: "load busy" });
  }
  return blocked;
}

function nodeGraphAudioPlayerPlaylistBoundItemKey(nodeId, pl) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const sid = nodeGraphAudioPlayerPlaylistSid(node?.sample?.id);
  if (!sid) {
    return "";
  }
  const bound = nodeGraphAudioPlayerPlaylistFindItemForSample(pl, sid);
  return nodeGraphAudioPlayerPlaylistItemKey(bound);
}

function nodeGraphAudioPlayerPlaylistEngineSampleId(nodeId, workletSampleId = "") {
  const fromWorklet = nodeGraphAudioPlayerPlaylistSid(workletSampleId);
  if (fromWorklet) {
    return fromWorklet;
  }
  const statusId = nodeGraphAudioPlayerPlaylistSid(
    nodeGraphMvp?.sampleRuntimeStatus?.get?.(nodeId)?.sampleId,
  );
  return statusId;
}

function nodeGraphAudioPlayerPlaylistOnRuntimeStatus(nodeId, reason = "", workletSampleId = "") {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return;
  }
  const pl = (node.playlist && Array.isArray(node.playlist.items))
    ? node.playlist
    : nodeGraphAudioPlayerPlaylistForNode(nodeId);
  if (!pl?.items?.length) {
    nodeGraphAudioPlayerPlaylistSyncScrubber(nodeId);
    return;
  }
  const id = String(nodeId || "");
  const text = String(reason || "").trim().toLowerCase();
  const playing = text === "engine playing" || text === "engine looping";
  const completed = text === "engine complete";
  const transport = Math.round(nodeGraphFiniteNumber(node.params?.transport));
  const wantKey = nodeGraphAudioPlayerPlaylistLoadTarget.get(id)
    || nodeGraphAudioPlayerPlaylistItemKey(pl.playing);
  const engineSid = nodeGraphAudioPlayerPlaylistEngineSampleId(nodeId, workletSampleId);
  const wantItem = (pl.items || []).find((item) => nodeGraphAudioPlayerPlaylistItemKey(item) === wantKey)
    || pl.playing
    || null;
  const boundKey = nodeGraphAudioPlayerPlaylistBoundItemKey(nodeId, pl);
  // Leftover = engine is still the previous file. Do not compare playlist
  // keys: a ghost card (pl-xxx) can share the sample id with the real path
  // row, which used to look like "still on previous file" forever.
  const leftoverOther = Boolean(
    engineSid
    && wantItem
    && !nodeGraphAudioPlayerPlaylistItemMatchesSample(wantItem, engineSid),
  );
  const finishedRequested = Boolean(
    engineSid
    && wantItem
    && nodeGraphAudioPlayerPlaylistItemMatchesSample(wantItem, engineSid),
  );
  if (playing) {
    if (nodeGraphAudioPlayerPlaylistLoadBusy.get(id) && leftoverOther) {
      nodeGraphAudioPlayerPlaylistDebug(id, "engine-playing-leftover", {
        reason: text,
        bound: boundKey,
        engineSid,
        transport,
        why: "engine still on previous file",
      });
      nodeGraphAudioPlayerPlaylistSyncScrubber(nodeId);
      return;
    }
    if (engineSid && nodeGraphAudioPlayerPlaylistLastCompletedSid.get(id) === engineSid) {
      nodeGraphAudioPlayerPlaylistLastCompletedSid.delete(id);
    }
    nodeGraphAudioPlayerPlaylistLoadBusy.set(id, false);
    nodeGraphAudioPlayerPlaylistLoadTarget.delete(id);
    nodeGraphAudioPlayerPlaylistAdvancePending.set(id, false);
    nodeGraphAudioPlayerPlaylistAdvanceArmed.set(id, true);
    nodeGraphAudioPlayerPlaylistDebug(id, "engine-playing-armed", {
      reason: text,
      bound: boundKey,
      engineSid,
      transport,
    });
    nodeGraphAudioPlayerPlaylistSyncScrubber(nodeId);
    return;
  }
  if (!completed) {
    if (text === "engine stopped" || text === "engine paused") {
      nodeGraphAudioPlayerPlaylistDebug(id, text.replace(" ", "-"), {
        reason: text,
        bound: boundKey,
        transport,
      });
    }
    nodeGraphAudioPlayerPlaylistSyncScrubber(nodeId);
    return;
  }
  if (engineSid && nodeGraphAudioPlayerPlaylistLastCompletedSid.get(id) === engineSid) {
    nodeGraphAudioPlayerPlaylistDebug(id, "complete-ignored", {
      reason: text,
      bound: boundKey,
      engineSid,
      transport,
      why: "already advanced this sample",
    });
    return;
  }
  if (leftoverOther) {
    nodeGraphAudioPlayerPlaylistDebug(id, "complete-ignored", {
      reason: text,
      bound: boundKey,
      engineSid,
      transport,
      why: "leftover complete from previous file",
    });
    return;
  }
  if (nodeGraphAudioPlayerPlaylistLoadBusy.get(id) && !engineSid) {
    nodeGraphAudioPlayerPlaylistDebug(id, "complete-ignored", {
      reason: text,
      bound: boundKey,
      engineSid,
      transport,
      why: "still loading, no sample bound",
    });
    return;
  }
  const armed = Boolean(nodeGraphAudioPlayerPlaylistAdvanceArmed.get(id));
  const busy = Boolean(nodeGraphAudioPlayerPlaylistLoadBusy.get(id));
  const loadingKey = nodeGraphAudioPlayerPlaylistLoadTarget.get(id) || "";
  const loadingItem = loadingKey
    ? (pl.items || []).find((item) => nodeGraphAudioPlayerPlaylistItemKey(item) === loadingKey)
    : null;
  if (busy && loadingItem && engineSid && !nodeGraphAudioPlayerPlaylistItemMatchesSample(loadingItem, engineSid)) {
    nodeGraphAudioPlayerPlaylistDebug(id, "complete-ignored", {
      reason: text,
      bound: boundKey,
      engineSid,
      transport,
      why: "already loading the next file",
    });
    return;
  }
  // Without a worklet sample id, node.sample.id is already the NEXT file
  // after bind — leftover "engine complete" looked like the new file ended.
  // Only treat unarmed complete as real if the worklet itself is on that file.
  if (!armed && !(busy && finishedRequested && workletSampleId)) {
    nodeGraphAudioPlayerPlaylistDebug(id, "complete-ignored", {
      reason: text,
      bound: boundKey,
      engineSid,
      workletSampleId: String(workletSampleId || ""),
      transport,
      why: !workletSampleId && busy
        ? "complete during load, no worklet sample id"
        : (busy ? "busy but bound is not the requested file" : "not armed (never saw engine playing)"),
    });
    return;
  }
  if (transport !== 4 && transport !== 5) {
    nodeGraphAudioPlayerPlaylistDebug(id, "complete-ignored", {
      reason: text,
      bound: boundKey,
      engineSid,
      transport,
      why: `transport ${transport} is not play-once/loop-all`,
    });
    return;
  }
  const retired = nodeGraphAudioPlayerPlaylistFindItemForSample(pl, engineSid) || pl.playing;
  const fromKey = nodeGraphAudioPlayerPlaylistItemKey(retired);
  nodeGraphAudioPlayerPlaylistLastCompletedSid.set(id, engineSid);
  nodeGraphAudioPlayerPlaylistMarkPlayedBySample(pl, engineSid);
  node.playlist = pl;
  nodeGraphAudioPlayerPlaylistRefreshUi(nodeId);
  nodeGraphAudioPlayerPlaylistAdvanceArmed.set(id, false);
  nodeGraphAudioPlayerPlaylistLoadBusy.set(id, true);
  nodeGraphAudioPlayerPlaylistAdvancePending.set(id, true);
  nodeGraphAudioPlayerPlaylistLoadTarget.delete(id);
  nodeGraphAudioPlayerPlaylistCancelAdvanceTimer(id);
  nodeGraphAudioPlayerPlaylistDebug(id, "complete-advance", {
    reason: text,
    bound: boundKey,
    engineSid,
    fromKey,
    transport,
    why: armed ? "armed complete" : "requested file completed before playing snapshot",
  });
  nodeGraphAudioPlayerPlaylistPlayNext(nodeId, { fromAuto: true, fromKey });
}

function nodeGraphAudioPlayerPlaylistSyncScrubber(nodeId) {
  const section = document.querySelector(
    `.node-sample-waveform-display[data-node="${CSS.escape(String(nodeId || ""))}"]`,
  );
  if (!section || !nodeGraphAudioPlayerFaceShowsPlaylist(section)) {
    return;
  }
  const scrub = section.querySelector("[data-music-player-phase-scrub]");
  const valueEl = section.querySelector("[data-music-player-phase-value]");
  if (!scrub && !valueEl) {
    return;
  }
  // Live engine phase (actual position after param smoothing / transport).
  // Same idea as Knob face showing scope Bias instead of the raw slider.
  const live = typeof nodeGraphSamplePhaseForNode === "function"
    ? nodeGraphSamplePhaseForNode(nodeId)
    : 0;
  if (scrub && document.activeElement !== scrub && scrub.dataset.scrubbing !== "1") {
    scrub.value = String(live);
  }
  if (valueEl) {
    valueEl.textContent = live.toFixed(4);
  }
}

function nodeGraphAudioPlayerPlaylistStartScrubLoop(nodeId) {
  const id = String(nodeId || "");
  if (!id || nodeGraphAudioPlayerPlaylistScrubLoops.has(id)) {
    return;
  }
  const tick = () => {
    const section = document.querySelector(
      `.node-sample-waveform-display[data-node="${CSS.escape(id)}"]`,
    );
    if (!section || !nodeGraphAudioPlayerFaceShowsPlaylist(section)) {
      nodeGraphAudioPlayerPlaylistScrubLoops.delete(id);
      return;
    }
    nodeGraphAudioPlayerPlaylistSyncScrubber(id);
    const handle = window.requestAnimationFrame(tick);
    nodeGraphAudioPlayerPlaylistScrubLoops.set(id, handle);
  };
  const handle = window.requestAnimationFrame(tick);
  nodeGraphAudioPlayerPlaylistScrubLoops.set(id, handle);
}

function nodeGraphAudioPlayerPlaylistStopScrubLoop(nodeId) {
  const id = String(nodeId || "");
  const handle = nodeGraphAudioPlayerPlaylistScrubLoops.get(id);
  if (handle) {
    window.cancelAnimationFrame(handle);
    nodeGraphAudioPlayerPlaylistScrubLoops.delete(id);
  }
}

const nodeGraphAudioPlayerPlaylistEnvelopeCache = new Map();
const nodeGraphAudioPlayerPlaylistEnvelopeBins = 512;
const nodeGraphAudioPlayerPlaylistEnvelopeStrideCap = 64;

function nodeGraphAudioPlayerPlaylistSamplesForId(sampleId) {
  const id = normalizeNodeGraphSampleId
    ? normalizeNodeGraphSampleId(sampleId)
    : String(sampleId || "").trim();
  if (!id) {
    return null;
  }
  const buf = nodeGraphMvp?.sampleBuffers?.get?.(id);
  if (!buf) {
    return null;
  }
  if (buf.samples?.length) {
    return buf.samples;
  }
  const channel = buf.channelData?.[0];
  return channel?.length ? channel : null;
}

function nodeGraphAudioPlayerPlaylistEnvelope(sampleId) {
  const samples = nodeGraphAudioPlayerPlaylistSamplesForId(sampleId);
  const length = samples?.length || 0;
  if (!length) {
    return null;
  }
  const cached = nodeGraphAudioPlayerPlaylistEnvelopeCache.get(sampleId);
  if (cached && cached.length === length) {
    return cached;
  }
  const bins = Math.min(nodeGraphAudioPlayerPlaylistEnvelopeBins, length);
  const mins = new Float32Array(bins);
  const maxs = new Float32Array(bins);
  for (let bin = 0; bin < bins; bin += 1) {
    const t0 = Math.floor((bin * length) / bins);
    const t1 = Math.max(t0 + 1, Math.floor(((bin + 1) * length) / bins));
    const stride = Math.max(1, Math.floor((t1 - t0) / nodeGraphAudioPlayerPlaylistEnvelopeStrideCap));
    let minV = 1;
    let maxV = -1;
    for (let frame = t0; frame < t1; frame += stride) {
      const value = samples[frame];
      if (value < minV) minV = value;
      if (value > maxV) maxV = value;
    }
    const last = samples[t1 - 1];
    if (last < minV) minV = last;
    if (last > maxV) maxV = last;
    mins[bin] = minV;
    maxs[bin] = maxV;
  }
  const envelope = { length, bins, mins, maxs };
  nodeGraphAudioPlayerPlaylistEnvelopeCache.set(sampleId, envelope);
  return envelope;
}

function nodeGraphAudioPlayerPlaylistSizeWaveCanvas(canvas) {
  if (!canvas) {
    return null;
  }
  const cssW = Math.max(1, canvas.clientWidth || 0);
  const cssH = Math.max(1, canvas.clientHeight || 0);
  const dpr = Math.max(1, nodeGraphFiniteNumber(window.devicePixelRatio, 1));
  const width = Math.max(1, Math.round(cssW * dpr));
  const height = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  return { context, width, height, pixelRatio: dpr };
}

function nodeGraphAudioPlayerPlaylistStrokeEnvelope(context, envelope, viewStart, viewEnd, width, midY, amplitude) {
  if (!envelope || !(width > 1)) {
    return false;
  }
  const span = Math.max(1e-9, viewEnd - viewStart);
  const startBin = Math.max(0, Math.floor((viewStart / envelope.length) * envelope.bins));
  const endBin = Math.min(envelope.bins - 1, Math.ceil((viewEnd / envelope.length) * envelope.bins));
  if (endBin < startBin) {
    return false;
  }
  context.beginPath();
  let started = false;
  for (let bin = startBin; bin <= endBin; bin += 1) {
    const frame = ((bin + 0.5) / envelope.bins) * envelope.length;
    const x = ((frame - viewStart) / span) * width;
    const yMax = midY - envelope.maxs[bin] * amplitude;
    if (!started) {
      context.moveTo(x, yMax);
      started = true;
    } else {
      context.lineTo(x, yMax);
    }
  }
  for (let bin = endBin; bin >= startBin; bin -= 1) {
    const frame = ((bin + 0.5) / envelope.bins) * envelope.length;
    const x = ((frame - viewStart) / span) * width;
    context.lineTo(x, midY - envelope.mins[bin] * amplitude);
  }
  context.closePath();
  return started;
}

function nodeGraphAudioPlayerPlaylistPaintWaveCanvas(canvas, {
  sampleId,
  live = false,
  viewStart = 0,
  viewEnd = 0,
  playheadFrame = null,
  settings = null,
} = {}) {
  const sized = nodeGraphAudioPlayerPlaylistSizeWaveCanvas(canvas);
  if (!sized) {
    return;
  }
  const { context, width, height, pixelRatio } = sized;
  context.fillStyle = live ? "hsl(140, 18%, 5%)" : "#050805";
  context.fillRect(0, 0, width, height);
  const samples = nodeGraphAudioPlayerPlaylistSamplesForId(sampleId);
  const total = samples?.length || 0;
  if (!total) {
    return;
  }
  const start = live ? nodeGraphFiniteNumber(viewStart) : 0;
  const end = live && viewEnd > viewStart ? viewEnd : total;
  const midY = height * 0.5;
  const amplitude = midY * 0.9;
  const look = settings;
  const stroke = typeof nodeGraphSampleWaveformLineColor === "function" && look
    ? nodeGraphSampleWaveformLineColor(look, 82, 0.92)
    : "rgba(120, 220, 180, 0.9)";
  const fill = typeof nodeGraphSampleWaveformLineColor === "function" && look
    ? nodeGraphSampleWaveformLineColor(look, 75, 0.28)
    : "rgba(80, 180, 140, 0.28)";
  let drew = false;
  if (
    live
    && typeof nodeGraphSampleWaveformBuildVectorPath === "function"
  ) {
    const points = nodeGraphSampleWaveformBuildVectorPath(
      samples,
      start,
      end,
      width,
      midY,
      amplitude,
    );
    if (nodeGraphAudioPlayerPlaylistStrokeVectorPath(context, points)) {
      context.strokeStyle = stroke;
      context.lineWidth = Math.max(1, pixelRatio);
      context.lineJoin = "miter";
      context.stroke();
      drew = true;
    }
  }
  if (!drew) {
    const envelope = nodeGraphAudioPlayerPlaylistEnvelope(sampleId);
    if (nodeGraphAudioPlayerPlaylistStrokeEnvelope(context, envelope, start, end, width, midY, amplitude)) {
      context.fillStyle = fill;
      context.fill();
      context.strokeStyle = stroke;
      context.lineWidth = Math.max(1, pixelRatio);
      context.stroke();
    }
  }
  if (live && Number.isFinite(playheadFrame) && playheadFrame >= start && playheadFrame <= end) {
    const x = ((playheadFrame - start) / Math.max(1e-9, end - start)) * width;
    context.strokeStyle = "rgba(255, 255, 255, 0.88)";
    context.lineWidth = Math.max(1, pixelRatio);
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
}

function nodeGraphAudioPlayerPlaylistPaintWaves(nodeId, { liveOnly = false } = {}) {
  const section = document.querySelector(
    `.node-sample-waveform-display[data-node="${CSS.escape(String(nodeId || ""))}"]`,
  );
  if (!section || !nodeGraphAudioPlayerFaceShowsPlaylist(section)) {
    return;
  }
  if (typeof applyNodeGraphSampleWaveformHudVars === "function") {
    applyNodeGraphSampleWaveformHudVars(
      section,
      typeof nodeGraphSampleWaveformSettingsForNode === "function"
        ? nodeGraphSampleWaveformSettingsForNode(nodeId)
        : null,
    );
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const playingId = normalizeNodeGraphSampleId
    ? normalizeNodeGraphSampleId(node?.sample?.id)
    : String(node?.sample?.id || "").trim();
  const settings = typeof nodeGraphSampleWaveformSettingsForNode === "function"
    ? nodeGraphSampleWaveformSettingsForNode(nodeId)
    : null;
  const playingEntry = typeof nodeGraphSampleWaveformSampleEntry === "function"
    ? nodeGraphSampleWaveformSampleEntry(nodeId)
    : null;
  const view = playingEntry && typeof nodeGraphSampleWaveformViewState === "function"
    ? nodeGraphSampleWaveformViewState(nodeId, playingEntry.frames, section)
    : null;
  const phase = typeof nodeGraphSamplePhaseForNode === "function"
    ? nodeGraphSamplePhaseForNode(nodeId)
    : 0;
  const playheadFrame = playingEntry ? phase * playingEntry.frames : 0;
  if (view && playingEntry && settings && typeof nodeGraphSampleWaveformContinuousView === "function") {
    const frames = Math.max(1, playingEntry.frames || 1);
    const rate = Math.max(1, nodeGraphFiniteNumber(playingEntry.sampleRate, 44100));
    const windowFrames = settings.timeWindowSeconds <= 0
      ? 1
      : Math.max(1, Math.min(frames, Math.round(settings.timeWindowSeconds * rate)));
    const ratio = typeof nodeGraphSampleWaveformScrollLineRatio === "function"
      ? nodeGraphSampleWaveformScrollLineRatio(settings)
      : 0.5;
    const next = nodeGraphSampleWaveformContinuousView(
      playheadFrame - windowFrames * ratio,
      windowFrames,
      frames,
    );
    view.startFrame = next.viewStart;
    view.endFrame = next.viewEnd;
  }
  const list = section.querySelector("[data-music-player-list]");
  if (list) {
    nodeGraphAudioPlayerPlaylistPaintSlots(nodeId, list, { followPlaying: false });
  }
}

function nodeGraphAudioPlayerPlaylistSmoothstep(t) {
  const x = Math.max(0, Math.min(1, nodeGraphFiniteNumber(t)));
  return x * x * (3 - 2 * x);
}

function nodeGraphAudioPlayerPlaylistPlayingIndex(nodeId, playingId = "") {
  const pl = nodeGraphAudioPlayerPlaylistEnsureQueues(nodeGraphAudioPlayerPlaylistForNode(nodeId));
  if (pl.playing) {
    const key = nodeGraphAudioPlayerPlaylistItemKey(pl.playing);
    const found = (pl.items || []).findIndex((item) => nodeGraphAudioPlayerPlaylistItemKey(item) === key);
    if (found >= 0) {
      return found;
    }
  }
  const hinted = Math.max(0, Math.round(nodeGraphFiniteNumber(pl.index)));
  const sid = normalizeNodeGraphSampleId
    ? normalizeNodeGraphSampleId(playingId)
    : String(playingId || "").trim();
  if (sid && pl.items[hinted]?.sampleId === sid) {
    return hinted;
  }
  if (sid) {
    const found = pl.items.findIndex((item) => item.sampleId === sid);
    if (found >= 0) {
      return found;
    }
  }
  return hinted;
}

/**
 * 0 = no fade. Slider up: fade over ~100 items, then tighten.
 * 1 = only the playing row is visible; everything else is fully faded.
 */
function nodeGraphAudioPlayerPlaylistSlotFade(index, playingIndex, slotCount, playlistFade = 0.25) {
  const amount = Math.max(0, Math.min(1, nodeGraphFiniteNumber(playlistFade)));
  if (amount <= 0) {
    return 1;
  }
  const dist = Math.abs((nodeGraphFiniteNumber(index)) - (nodeGraphFiniteNumber(playingIndex)));
  const span = 100 + (1 - 100) * amount;
  return 1 - nodeGraphAudioPlayerPlaylistSmoothstep(Math.min(1, dist / Math.max(1, span)));
}

function nodeGraphAudioPlayerPlaylistApplyRowFade(section, nodeId) {
  const list = section?.querySelector?.("[data-music-player-list]");
  if (!list) {
    return;
  }
  nodeGraphAudioPlayerPlaylistPaintSlots(nodeId, list, { followPlaying: false });
}

function nodeGraphAudioPlayerPlaylistRowHeightPx(list) {
  const sample = list?.querySelector?.(".node-music-player-pl-row");
  if (sample && sample.offsetHeight > 0) {
    return sample.offsetHeight;
  }
  const raw = list ? getComputedStyle(list).getPropertyValue("--node-music-player-pl-row-height") : "";
  const parsed = Number.parseFloat(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    const fontSize = Number.parseFloat(list ? getComputedStyle(list).fontSize : "") || 16;
    return raw.trim().endsWith("rem") ? parsed * fontSize : parsed;
  }
  return 18;
}

function nodeGraphAudioPlayerPlaylistVisibleSlotCount(list) {
  const height = Math.max(0, list?.clientHeight || 0);
  const rowH = Math.max(14, nodeGraphAudioPlayerPlaylistRowHeightPx(list));
  return Math.max(1, Math.floor(height / rowH) || 1);
}

function nodeGraphAudioPlayerPlaylistSlotCount(list, nodeId) {
  const id = nodeId || list?.closest?.("[data-node]")?.dataset?.node;
  const settings = typeof nodeGraphSampleWaveformSettingsForNode === "function"
    ? nodeGraphSampleWaveformSettingsForNode(id)
    : null;
  const want = Math.round(Number(settings?.playlistVisibleCount));
  const items = typeof nodeGraphAudioPlayerPlaylistForNode === "function"
    ? (nodeGraphAudioPlayerPlaylistForNode(id)?.items?.length || 0)
    : 0;
  const fitted = nodeGraphAudioPlayerPlaylistVisibleSlotCount(list);
  // 2…10 = fixed slot count. 1 / unset = fill the face; never collapse a
  // multi-track list to a single oversized row.
  if (Number.isFinite(want) && want >= 2) {
    return Math.max(2, Math.min(10, want));
  }
  if (fitted > 1) {
    return Math.max(1, Math.min(10, fitted));
  }
  return Math.max(1, Math.min(10, items > 1 ? items : 8));
}

function nodeGraphAudioPlayerPlaylistClampViewStart(start, itemCount, slotCount) {
  const maxStart = Math.max(0, (nodeGraphFiniteNumber(itemCount)) - Math.max(1, nodeGraphFiniteNumber(slotCount, 1)));
  return Math.max(0, Math.min(maxStart, Math.round(nodeGraphFiniteNumber(start))));
}

function nodeGraphAudioPlayerPlaylistBindListResize(list, nodeId) {
  if (!list || list.dataset.slotResizeBound === "1") {
    return;
  }
  list.dataset.slotResizeBound = "1";
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver((entries) => {
      const height = Math.round(entries[0]?.contentRect?.height || list.clientHeight || 0);
      if (list.dataset.plObsH === String(height)) {
        return;
      }
      list.dataset.plObsH = String(height);
      nodeGraphAudioPlayerPlaylistPaintSlots(nodeId, list, { followPlaying: false });
    });
    observer.observe(list);
  }
  list.addEventListener("wheel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
    const slots = nodeGraphAudioPlayerPlaylistSlotCount(list, nodeId);
    const step = event.deltaY > 0 || event.deltaX > 0 ? 1 : -1;
    const next = nodeGraphAudioPlayerPlaylistClampViewStart(
      (nodeGraphFiniteNumber(list.dataset.plViewStart)) + step,
      pl.items.length,
      slots,
    );
    list.dataset.plViewStart = String(next);
    nodeGraphAudioPlayerPlaylistPaintSlots(nodeId, list, { followPlaying: false });
  }, { passive: false });
  list.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".node-music-player-pl-row")) {
      event.stopPropagation();
    }
  });
  list.addEventListener("click", (event) => {
    const row = event.target.closest(".node-music-player-pl-row");
    if (!row || row.dataset.slot === "empty") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (list.__playNextClickTimer) {
      window.clearTimeout(list.__playNextClickTimer);
    }
    const index = Number(row.dataset.playlistIndex);
    list.__playNextClickTimer = window.setTimeout(() => {
      list.__playNextClickTimer = 0;
      nodeGraphAudioPlayerPlaylistTogglePlayNext(nodeId, index);
    }, 250);
  });
  list.addEventListener("dblclick", (event) => {
    const row = event.target.closest(".node-music-player-pl-row");
    if (!row || row.dataset.slot === "empty") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (list.__playNextClickTimer) {
      window.clearTimeout(list.__playNextClickTimer);
      list.__playNextClickTimer = 0;
    }
    nodeGraphAudioPlayerPlaylistActivateRow(nodeId, Number(row.dataset.playlistIndex), { play: true });
  });
}

// Face buttons are a fixed slot pool (how many rows fit). The file list is
// separate data. Wheel only changes which list index each slot shows.
function nodeGraphAudioPlayerPlaylistEnsureSlotButtons(list, slotCount) {
  const want = Math.max(1, Math.round(nodeGraphFiniteNumber(slotCount, 1)));
  list.querySelectorAll(".node-music-player-pl-virtual-rail").forEach((el) => el.remove());
  const rows = [...list.querySelectorAll(":scope > .node-music-player-pl-row")];
  if (rows.length === want) {
    return want;
  }
  if (rows.length > want) {
    for (let i = want; i < rows.length; i += 1) {
      rows[i].remove();
    }
    return want;
  }
  for (let i = rows.length; i < want; i += 1) {
    list.append(nodeGraphAudioPlayerPlaylistMakeRowShell(i, { empty: true }));
  }
  return want;
}

function nodeGraphAudioPlayerPlaylistPaintSlots(nodeId, list, { followPlaying = false } = {}) {
  if (!list) {
    return;
  }
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  const items = pl.items;
  const slotCount = nodeGraphAudioPlayerPlaylistEnsureSlotButtons(
    list,
    nodeGraphAudioPlayerPlaylistSlotCount(list, nodeId),
  );
  list.classList.toggle("is-single", slotCount <= 1 && items.length <= 1);
  const playingId = normalizeNodeGraphSampleId
    ? normalizeNodeGraphSampleId(nodeGraphPatchNode(nodeId)?.sample?.id)
    : String(nodeGraphPatchNode(nodeId)?.sample?.id || "").trim();
  const playingIndex = nodeGraphAudioPlayerPlaylistPlayingIndex(nodeId, playingId);
  let start = nodeGraphFiniteNumber(list.dataset.plViewStart);
  if (items.length <= slotCount) {
    start = 0;
  } else if (followPlaying && (playingIndex < start || playingIndex >= start + slotCount)) {
    start = playingIndex;
  }
  start = nodeGraphAudioPlayerPlaylistClampViewStart(start, items.length, slotCount);
  list.dataset.plViewStart = String(start);
  const selected = Number.isInteger(pl.selectedIndex) ? pl.selectedIndex : pl.index;
  const settings = typeof nodeGraphSampleWaveformSettingsForNode === "function"
    ? nodeGraphSampleWaveformSettingsForNode(nodeId)
    : null;
  const fadeAmt = settings?.playlistFade;
  const rows = list.querySelectorAll(":scope > .node-music-player-pl-row");
  for (let slot = 0; slot < rows.length; slot += 1) {
    const row = rows[slot];
    const index = start + slot;
    const item = items[index];
    row.dataset.playlistIndex = String(index);
    row.style.setProperty(
      "--node-music-player-pl-fade",
      String(nodeGraphAudioPlayerPlaylistSlotFade(index, playingIndex, slotCount, fadeAmt)),
    );
    if (!item) {
      row.classList.add("is-empty");
      row.classList.remove("is-played", "is-play-next");
      row.dataset.slot = "empty";
      row.tabIndex = -1;
      row.setAttribute("aria-hidden", "true");
      row.dataset.active = "false";
      row.dataset.playing = "false";
      row.dataset.queue = "";
      row.dataset.sampleId = "";
      row.title = "";
      const nameEmpty = row.querySelector(".node-music-player-pl-name");
      const numEmpty = row.querySelector(".node-music-player-pl-num");
      if (nameEmpty) nameEmpty.textContent = "";
      if (numEmpty) numEmpty.textContent = "";
      continue;
    }
    row.classList.remove("is-empty");
    delete row.dataset.slot;
    row.tabIndex = 0;
    row.removeAttribute("aria-hidden");
    row.dataset.sampleId = item.sampleId;
    row.dataset.active = index === selected ? "true" : "false";
    const playedKeys = nodeGraphAudioPlayerPlaylistPlayedKeySet(pl);
    const playingKey = nodeGraphAudioPlayerPlaylistItemKey(pl.playing);
    const playNextKey = nodeGraphAudioPlayerPlaylistItemKey(pl.playNext);
    const itemKey = nodeGraphAudioPlayerPlaylistItemKey(item);
    const isPlaying = Boolean(itemKey) && itemKey === playingKey;
    const isPlayNext = Boolean(itemKey) && itemKey === playNextKey && !isPlaying;
    const isPlayed = Boolean(itemKey) && playedKeys.has(itemKey) && !isPlaying;
    row.dataset.playing = isPlaying ? "true" : "false";
    row.dataset.queue = isPlaying ? "playing" : (isPlayNext ? "next" : (isPlayed ? "played" : "unplayed"));
    row.classList.toggle("is-played", isPlayed);
    row.classList.toggle("is-play-next", isPlayNext);
    const num = row.querySelector(".node-music-player-pl-num");
    const name = row.querySelector(".node-music-player-pl-name");
    if (num) {
      // listNumber is 1-based (library sets index + 1); 0 / missing falls back to the row's 1-based position.
      const storedNumber = Math.round(nodeGraphFiniteNumber(item.listNumber, 0));
      const listNumber = storedNumber >= 1 ? storedNumber : index + 1;
      num.textContent = String(listNumber).padStart(2, "0");
    }
    if (name) {
      name.textContent = nodeGraphAudioPlayerPlaylistFileName(item);
    }
    row.title = isPlayNext
      ? "Play next (click to cancel)"
      : (item.path || item.name || "Click to play next, double-click to play now");
  }
  return slotCount;
}

function nodeGraphAudioPlayerPlaylistMakeRowShell(index, { empty = false } = {}) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "node-music-player-pl-row";
  row.dataset.playlistIndex = String(index);
  if (empty) {
    row.classList.add("is-empty");
    row.dataset.slot = "empty";
    row.tabIndex = -1;
    row.setAttribute("aria-hidden", "true");
  }
  const num = document.createElement("span");
  num.className = "node-music-player-pl-num";
  num.textContent = String(index + 1).padStart(2, "0");
  const name = document.createElement("span");
  name.className = "node-music-player-pl-name";
  row.append(num, name);
  return row;
}

function nodeGraphAudioPlayerPlaylistTogglePlayNext(nodeId, index) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return;
  }
  const pl = nodeGraphAudioPlayerPlaylistEnsureQueues(nodeGraphAudioPlayerPlaylistForNode(nodeId));
  const item = pl.items[index];
  if (!item) {
    return;
  }
  pl.selectedIndex = Math.max(0, Math.min(pl.items.length - 1, Math.round(nodeGraphFiniteNumber(index))));
  const key = nodeGraphAudioPlayerPlaylistItemKey(item);
  const playingKey = nodeGraphAudioPlayerPlaylistItemKey(pl.playing);
  if (!key || key === playingKey) {
    node.playlist = pl;
    nodeGraphAudioPlayerPlaylistRefreshUi(nodeId);
    nodeGraphAudioPlayerPlaylistPersist(nodeId);
    return;
  }
  if (nodeGraphAudioPlayerPlaylistItemKey(pl.playNext) === key) {
    pl.playNext = null;
    if (typeof setNodeGraphSampleStatus === "function") {
      setNodeGraphSampleStatus(nodeId, "play next cleared");
    }
  } else {
    pl.playNext = item;
    if (typeof setNodeGraphSampleStatus === "function") {
      setNodeGraphSampleStatus(nodeId, `play next: ${nodeGraphAudioPlayerPlaylistFileName(item)}`);
    }
  }
  node.playlist = pl;
  nodeGraphAudioPlayerPlaylistRefreshUi(nodeId);
  nodeGraphAudioPlayerPlaylistPersist(nodeId);
}

function nodeGraphAudioPlayerPlaylistActivateRow(nodeId, index, { play = false } = {}) {
  if (!play) {
    return;
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node) {
    return;
  }
  const pl = nodeGraphAudioPlayerPlaylistEnsureQueues(nodeGraphAudioPlayerPlaylistForNode(nodeId));
  const item = pl.items[index];
  if (!item) {
    return;
  }
  // Double-click means play now. PlayIndex applies the existing loop mode
  // (off / one / all) and must not navigate away from the playlist face.
  nodeGraphAudioPlayerPlaylistPlayIndex(nodeId, index, { autoplay: true });
}

function nodeGraphAudioPlayerPlaylistRefreshUi(nodeId) {
  if (typeof nodeGraphAudioPlayerPlaylistEnsureCurrentSample === "function") {
    nodeGraphAudioPlayerPlaylistEnsureCurrentSample(nodeId, { persist: false, refresh: false });
  }
  const section = document.querySelector(
    `.node-sample-waveform-display[data-node="${CSS.escape(String(nodeId || ""))}"]`,
  );
  if (!section) {
    return;
  }
  const list = section.querySelector("[data-music-player-list]");
  if (list) {
    nodeGraphAudioPlayerPlaylistBindListResize(list, nodeId);
    nodeGraphAudioPlayerPlaylistPaintSlots(nodeId, list, { followPlaying: true });
    window.requestAnimationFrame(() => {
      nodeGraphAudioPlayerPlaylistPaintSlots(nodeId, list, { followPlaying: false });
    });
  }
  nodeGraphAudioPlayerPlaylistSyncNowSong(nodeId);
  if (nodeGraphAudioPlayerFaceShowsPlayinfo(section)) {
    nodeGraphAudioPlayerPlaylistRefreshRamDebug(nodeId);
  }
  nodeGraphAudioPlayerPlaylistSyncTransport(nodeId);
}

function nodeGraphAudioPlayerPlaylistRefreshRamDebug(nodeId) {
  const section = document.querySelector(
    `.node-sample-waveform-display[data-node="${CSS.escape(String(nodeId || ""))}"]`,
  );
  if (!section) {
    return;
  }
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  const ram = nodeGraphAudioPlayerPlaylistRamSummary(nodeId);
  const panel = section.querySelector("[data-music-player-ram-panel]");
  if (!panel) {
    return;
  }
  panel.hidden = false;
  const body = panel.querySelector("[data-music-player-ram-body]");
  if (!body) {
    return;
  }
  body.replaceChildren();
  const summary = document.createElement("div");
  summary.className = "node-music-player-pl-ram-summary";
  summary.innerHTML = `<strong>${ram.label}</strong>`
    + ` · loaded ${ram.loaded}/${ram.tracks}`
    + ` · ${ram.frames.toLocaleString()} frames`
    + (ram.hog ? ` · <span class="is-hog">HOG ≥64MB</span>` : "");
  body.append(summary);

  const table = document.createElement("table");
  table.className = "node-music-player-pl-ram-table";
  table.innerHTML = "<thead><tr><th>#</th><th>Track</th><th>RAM</th><th>Frames</th><th>Ch</th><th>SR</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  if (!pl.items.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="7" class="node-music-player-pl-ram-empty">No tracks in playlist</td>';
    tbody.append(tr);
  } else {
    const playingId = normalizeNodeGraphSampleId
      ? normalizeNodeGraphSampleId(nodeGraphPatchNode(nodeId)?.sample?.id)
      : String(nodeGraphPatchNode(nodeId)?.sample?.id || "").trim();
    pl.items.forEach((item, index) => {
      const est = nodeGraphAudioPlayerPlaylistEstimateBytes(item.sampleId);
      const tr = document.createElement("tr");
      if (index === pl.index) {
        tr.dataset.active = "true";
      }
      if (playingId && item.sampleId === playingId) {
        tr.dataset.playing = "true";
      }
      if ((est.bytes || item.bytes || 0) >= 32 * 1024 * 1024) {
        tr.classList.add("is-heavy");
      }
      const td = (text, className) => {
        const cell = document.createElement("td");
        if (className) cell.className = className;
        cell.textContent = text;
        return cell;
      };
      tr.append(
        td(String(index + 1).padStart(2, "0")),
        (() => {
          const cell = td(String(item.name || ""), "node-music-player-pl-ram-name");
          cell.title = String(item.name || "");
          return cell;
        })(),
        td(nodeGraphAudioPlayerPlaylistFormatBytes(est.bytes || item.bytes || 0)),
        td((est.frames || item.frames || 0).toLocaleString()),
        td(String(est.channels || item.channels || "—")),
        td(String(est.sampleRate || item.sampleRate || "—")),
        td(est.loaded ? "RAM" : "—"),
      );
      tbody.append(tr);
    });
  }
  table.append(tbody);
  body.append(table);
}

function nodeGraphAudioPlayerPlaylistBindScrubber(nodeId, scrub) {
  if (!scrub) {
    return;
  }
  const valueEl = () => scrub.closest?.("[data-music-player-page]")
    ?.querySelector?.("[data-music-player-phase-value]");

  scrub.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    scrub.dataset.scrubbing = "1";
  });
  const endScrub = () => {
    scrub.dataset.scrubbing = "0";
  };
  scrub.addEventListener("pointerup", endScrub);
  scrub.addEventListener("pointercancel", endScrub);
  scrub.addEventListener("blur", endScrub);

  scrub.addEventListener("input", () => {
    const phase = Math.max(0, Math.min(1, nodeGraphFiniteNumber(scrub.value)));
    // Live drag: drive Phase Offset param so it behaves like any other control.
    nodeGraphAudioPlayerPlaylistApplyScrub(nodeId, phase, { record: false, commit: false });
    // While dragging, show scrub target; rAF loop resumes actual engine Phase after release.
    const el = valueEl();
    if (el) {
      el.textContent = phase.toFixed(4);
    }
  });
  scrub.addEventListener("change", () => {
    const phase = Math.max(0, Math.min(1, nodeGraphFiniteNumber(scrub.value)));
    // Commit folds offset into free-running samplePhase (clean param = 0).
    nodeGraphAudioPlayerPlaylistApplyScrub(nodeId, phase, { record: true, commit: true });
    scrub.dataset.scrubbing = "0";
  });
}

/**
 * Wrap phosphor waveform section with face bar + playlist page.
 * Called once when the Music Player display is created.
 */
function nodeGraphAudioPlayerPlaylistEnhanceDisplay(section, nodeId) {
  if (!section || section.dataset.musicPlayerEnhanced === "1") {
    return section;
  }
  section.dataset.musicPlayerEnhanced = "1";
  section.dataset.musicPlayerFace = "wave";

  const canvas = section.querySelector("canvas");
  const wavePage = document.createElement("div");
  wavePage.className = "node-music-player-page node-music-player-page-wave";
  wavePage.dataset.musicPlayerPage = "wave";
  if (canvas) {
    wavePage.append(canvas);
  }

  const plPage = document.createElement("div");
  plPage.className = "node-music-player-page node-music-player-page-pl";
  plPage.dataset.musicPlayerPage = "pl";
  plPage.hidden = true;

  const list = document.createElement("div");
  list.className = "node-music-player-pl-list";
  list.dataset.musicPlayerList = "true";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Playlist tracks");

  plPage.append(list);

  const playinfoPage = document.createElement("div");
  playinfoPage.className = "node-music-player-page node-music-player-page-playinfo";
  playinfoPage.dataset.musicPlayerPage = "playinfo";
  playinfoPage.hidden = true;
  const ramPanel = document.createElement("div");
  ramPanel.className = "node-music-player-pl-ram-panel";
  ramPanel.dataset.musicPlayerRamPanel = "true";
  const ramBody = document.createElement("div");
  ramBody.className = "node-music-player-pl-ram-body";
  ramBody.dataset.musicPlayerRamBody = "true";
  ramPanel.append(ramBody);
  playinfoPage.append(ramPanel);

  const vsxyPage = document.createElement("div");
  vsxyPage.className = "node-music-player-page node-music-player-page-vs";
  vsxyPage.dataset.musicPlayerPage = "vsxy";
  vsxyPage.hidden = true;
  const vsxyCanvas = document.createElement("canvas");
  vsxyCanvas.className = "node-music-player-vs-canvas";
  vsxyCanvas.dataset.musicPlayerVs = "xy";
  vsxyPage.append(vsxyCanvas);

  const vslrPage = document.createElement("div");
  vslrPage.className = "node-music-player-page node-music-player-page-vs";
  vslrPage.dataset.musicPlayerPage = "vslr";
  vslrPage.hidden = true;
  const vslrCanvas = document.createElement("canvas");
  vslrCanvas.className = "node-music-player-vs-canvas";
  vslrCanvas.dataset.musicPlayerVs = "lr";
  vslrPage.append(vslrCanvas);

  const waveplayPage = document.createElement("div");
  waveplayPage.className = "node-music-player-page node-music-player-page-waveplay";
  waveplayPage.dataset.musicPlayerPage = "waveplay";
  waveplayPage.hidden = true;
  const waveplayWave = document.createElement("div");
  waveplayWave.className = "node-music-player-waveplay-wave";
  waveplayWave.dataset.musicPlayerWaveHost = "true";
  waveplayPage.append(waveplayWave);
  waveplayPage.append(nodeGraphAudioPlayerPlaylistCreateNowSong(nodeId));

  plPage.append(nodeGraphAudioPlayerPlaylistCreateTransport(nodeId));

  section.replaceChildren(wavePage, waveplayPage, plPage, playinfoPage, vsxyPage, vslrPage);
  nodeGraphAudioPlayerPlaylistEnsureLayout(section, nodeId);

  nodeGraphAudioPlayerPlaylistBindWaveSeek(section, nodeId);
  nodeGraphAudioPlayerPlaylistApplyFace(nodeId);

  window.requestAnimationFrame(() => {
    nodeGraphAudioPlayerPlaylistEnsureCurrentSample(nodeId);
  });

  return section;
}

function nodeGraphAudioPlayerVideoscopeChannels(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const sampleId = node?.sample?.id;
  const entry = sampleId ? nodeGraphMvp?.sampleBuffers?.get?.(sampleId) : null;
  const left = entry?.channelData?.[0] || entry?.samples;
  if (!left?.length) {
    return null;
  }
  return {
    left,
    right: entry?.channelData?.[1] || left,
    frames: Math.max(1, nodeGraphFiniteNumber(entry.frames, left.length)),
    sampleRate: Math.max(1, nodeGraphFiniteNumber(entry.sampleRate, 44100)),
  };
}

function nodeGraphAudioPlayerVideoscopeWindow(nodeId, frames, sampleRate) {
  const settings = typeof nodeGraphSampleWaveformSettingsForNode === "function"
    ? nodeGraphSampleWaveformSettingsForNode(nodeId)
    : null;
  const rate = Math.max(1, nodeGraphFiniteNumber(sampleRate, 44100));
  const seconds = Number(settings?.timeWindowSeconds);
  const want = Number.isFinite(seconds) && seconds > 0
    ? Math.round(seconds * rate)
    : 2048;
  const span = Math.max(64, Math.min(frames, want, 8192));
  const phase = typeof nodeGraphSamplePhaseForNode === "function"
    ? nodeGraphSamplePhaseForNode(nodeId)
    : 0;
  const playhead = Math.max(0, Math.min(frames, phase * frames));
  let start = Math.round(playhead - span * 0.5);
  if (start < 0) {
    start = 0;
  }
  if (start + span > frames) {
    start = Math.max(0, frames - span);
  }
  return { start, end: Math.min(frames, start + span), playhead, span };
}

function nodeGraphAudioPlayerVideoscopePaint(section) {
  const face = section?.dataset?.musicPlayerFace;
  if (face !== "vsxy" && face !== "vslr") {
    return;
  }
  const canvas = section.querySelector(`[data-music-player-page="${face}"] canvas`);
  if (!canvas) {
    return;
  }
  const nodeId = section.dataset.node || "";
  const settings = typeof nodeGraphSampleWaveformSettingsForNode === "function"
    ? nodeGraphSampleWaveformSettingsForNode(nodeId)
    : null;
  const page = canvas.parentElement;
  const cssW = Math.max(8, Math.round(page?.clientWidth || canvas.clientWidth || 8));
  const cssH = Math.max(8, Math.round(page?.clientHeight || canvas.clientHeight || 8));
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(8, Math.round(cssW * pixelRatio));
  const height = Math.max(8, Math.round(cssH * pixelRatio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  const bg = typeof nodeGraphSampleWaveformBackgroundColor === "function"
    ? nodeGraphSampleWaveformBackgroundColor(settings)
    : "#050805";
  context.fillStyle = bg;
  context.fillRect(0, 0, width, height);
  const channels = nodeGraphAudioPlayerVideoscopeChannels(nodeId);
  if (face === "vsxy") {
    nodeGraphAudioPlayerVideoscopePaintXy(context, width, height, channels, settings, nodeId);
  } else {
    nodeGraphAudioPlayerVideoscopePaintLr(context, width, height, channels, settings, nodeId);
  }
}

function nodeGraphAudioPlayerVideoscopePaintXy(context, width, height, channels, settings, nodeId) {
  const axis = typeof nodeGraphSampleWaveformLineColor === "function"
    ? nodeGraphSampleWaveformLineColor(settings, 57, 0.28)
    : "rgba(80, 160, 130, 0.28)";
  const ink = typeof nodeGraphSampleWaveformLineColor === "function"
    ? nodeGraphSampleWaveformLineColor(settings, 82, 0.9)
    : "rgba(180, 230, 200, 0.9)";
  context.strokeStyle = axis;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(width * 0.5, 0);
  context.lineTo(width * 0.5, height);
  context.moveTo(0, height * 0.5);
  context.lineTo(width, height * 0.5);
  context.stroke();
  if (!channels) {
    const cx = width * 0.5;
    const cy = height * 0.5;
    context.strokeStyle = axis;
    context.beginPath();
    context.moveTo(cx - 4, cy);
    context.lineTo(cx + 4, cy);
    context.moveTo(cx, cy - 4);
    context.lineTo(cx, cy + 4);
    context.stroke();
    return;
  }
  const win = nodeGraphAudioPlayerVideoscopeWindow(nodeId, channels.frames, channels.sampleRate);
  const count = Math.max(1, win.end - win.start);
  const step = Math.max(1, Math.floor(count / Math.max(width, 256)));
  context.strokeStyle = ink;
  {
    const faceMin = faceMinSide(width, height);
    const unit = settings && Number.isFinite(Number(settings.traceWidth))
      ? Number(settings.traceWidth)
      : nodeGraphSampleWaveformDefaultSettings.traceWidth;
    context.lineWidth = Math.max(0.25, faceInkPx(clampAuthoredInkPx(unit, 2), faceMin));
  }
  context.beginPath();
  let started = false;
  for (let i = win.start; i < win.end; i += step) {
    const x = ((nodeGraphFiniteNumber(channels.left[i])) * 0.5 + 0.5) * (width - 1);
    const y = (0.5 - (nodeGraphFiniteNumber(channels.right[i])) * 0.5) * (height - 1);
    if (!started) {
      context.moveTo(x, y);
      started = true;
    } else {
      context.lineTo(x, y);
    }
  }
  if (started) {
    context.stroke();
  }
  const play = Math.max(win.start, Math.min(win.end - 1, Math.round(win.playhead)));
  const hx = ((nodeGraphFiniteNumber(channels.left[play])) * 0.5 + 0.5) * (width - 1);
  const hy = (0.5 - (nodeGraphFiniteNumber(channels.right[play])) * 0.5) * (height - 1);
  context.strokeStyle = "rgba(255, 255, 255, 0.9)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(hx - 4, hy);
  context.lineTo(hx + 4, hy);
  context.moveTo(hx, hy - 4);
  context.lineTo(hx, hy + 4);
  context.stroke();
}

function nodeGraphAudioPlayerVideoscopePaintLr(context, width, height, channels, settings, nodeId) {
  const mid = Math.round(height * 0.5);
  const line = typeof nodeGraphSampleWaveformLineColor === "function"
    ? nodeGraphSampleWaveformLineColor(settings, 57, 0.28)
    : "rgba(80, 160, 130, 0.28)";
  context.fillStyle = line;
  context.fillRect(0, mid, width, 1);
  const leftZero = Math.round(mid * 0.5);
  const rightZero = mid + Math.round((height - mid) * 0.5);
  context.fillRect(0, leftZero, width, 1);
  context.fillRect(0, rightZero, width, 1);
  if (!channels) {
    return;
  }
  const win = nodeGraphAudioPlayerVideoscopeWindow(nodeId, channels.frames, channels.sampleRate);
  const paintPane = (channel, top, paneH, color) => {
    const center = top + paneH * 0.5;
    const amp = paneH * 0.42;
    const count = Math.max(1, win.end - win.start);
    context.strokeStyle = color;
    {
      const faceMin = faceMinSide(width, height);
      const unit = settings && Number.isFinite(Number(settings.traceWidth))
        ? Number(settings.traceWidth)
        : nodeGraphSampleWaveformDefaultSettings.traceWidth;
      context.lineWidth = Math.max(0.25, faceInkPx(clampAuthoredInkPx(unit, 2), faceMin));
    }
    context.beginPath();
    for (let x = 0; x < width; x += 1) {
      const i0 = win.start + Math.floor((x / width) * count);
      const i1 = win.start + Math.floor(((x + 1) / width) * count);
      let min = 1;
      let max = -1;
      for (let i = i0; i < Math.max(i0 + 1, i1); i += 1) {
        const s = nodeGraphFiniteNumber(channel[i]);
        if (s < min) min = s;
        if (s > max) max = s;
      }
      const y0 = center - max * amp;
      const y1 = center - min * amp;
      context.moveTo(x + 0.5, y0);
      context.lineTo(x + 0.5, y1);
    }
    context.stroke();
  };
  paintPane(channels.left, 0, mid, "rgba(220, 70, 70, 0.92)");
  paintPane(channels.right, mid, height - mid, "rgba(70, 140, 230, 0.92)");
  const playX = win.span > 0
    ? Math.round(((win.playhead - win.start) / win.span) * width)
    : 0;
  context.fillStyle = "rgba(255, 255, 255, 0.85)";
  context.fillRect(playX, 0, 1, height);
}

// Hook runtime status → auto-advance + scrubber live update.
(function nodeGraphAudioPlayerPlaylistInstallRuntimeHook() {
  if (typeof window === "undefined" || window.__nodeGraphAudioPlayerPlaylistHooked) {
    return;
  }
  window.__nodeGraphAudioPlayerPlaylistHooked = true;
  window.__nodeGraphAudioPlayerPlaylistWrapRuntime = function wrapRuntime() {
    if (typeof syncNodeGraphAudioPlayerRuntimeStatus !== "function") {
      return;
    }
    if (syncNodeGraphAudioPlayerRuntimeStatus.__playlistWrapped) {
      return;
    }
    const original = syncNodeGraphAudioPlayerRuntimeStatus;
    function wrapped(message = {}) {
      original(message);
    }
    wrapped.__playlistWrapped = true;
    // Global function reassignment
    // eslint-disable-next-line no-global-assign
    syncNodeGraphAudioPlayerRuntimeStatus = wrapped;
  };
})();

function nodeGraphAudioPlayerPlaylistMigrateOpenDisplays() {
  document.querySelectorAll(".node-sample-waveform-display[data-music-player-enhanced='1']").forEach((section) => {
    const nodeId = section.dataset.node;
    if (nodeId) {
      nodeGraphAudioPlayerPlaylistApplyFace(nodeId);
    }
  });
}
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", nodeGraphAudioPlayerPlaylistMigrateOpenDisplays, { once: true });
  } else {
    window.requestAnimationFrame(nodeGraphAudioPlayerPlaylistMigrateOpenDisplays);
  }
}

/**
 * Click / drag on the waveform display moves the playhead. This follows the
 * Knob face → Bias pattern (attachNodeGraphKnobFaceDrag + beginNodeSliderDrag):
 * - a pointerdown on the face surface starts a drag;
 * - it is ignored while another slider drag is active, for non-primary
 *   buttons, and for the second press of a double-click (which goes to the
 *   face's own dblclick action);
 * - the drag captures the pointer and stops the event so the module/graph
 *   drag never starts;
 * - every move writes the live value with no history entry;
 * - release commits once.
 * The value is the file phase under the pointer in the current waveform
 * view (zoom/pan window), not 0..1 of the whole file across the screen.
 * getBoundingClientRect so workspace zoom and whole-module embed scale work.
 * Writes go through nodeGraphAudioPlayerPlaylistApplyScrub (phase-offset).
 * Seeks are not undo steps, the same as the transport.
 * Plain drag on the wave page used to pan the view. Pan is now Alt-drag;
 * Shift-drag (relative nudge) and the region handles are unchanged.
 */
function nodeGraphAudioPlayerPlaylistBindWaveSeek(section, nodeId) {
  if (!section || section.dataset.musicPlayerWaveSeekBound === "1") {
    return;
  }
  section.dataset.musicPlayerWaveSeekBound = "1";
  const surfaceFor = (target) => target?.closest?.(".node-music-player-page-wave, .node-music-player-waveplay-wave");
  const idFor = () => String(nodeId || section.closest?.("[data-node]")?.dataset?.node || "");
  const phaseAt = (surface, event) => {
    const hit = surface.querySelector?.("canvas.node-sample-waveform-canvas") || surface;
    const rect = hit.getBoundingClientRect();
    const x = rect.width > 0 ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 0;
    const id = idFor();
    const entry = typeof nodeGraphSampleWaveformSampleEntry === "function"
      ? nodeGraphSampleWaveformSampleEntry(id)
      : nodeGraphMvp?.sampleBuffers?.get?.(
        typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(id)?.sample?.id : "",
      );
    const frames = Math.max(1, Math.round(Number(entry?.frames) || 0) || 1);
    if (entry?.frames && typeof nodeGraphSampleWaveformViewState === "function") {
      const state = nodeGraphSampleWaveformViewState(id, entry.frames, section);
      const viewStart = Number(state.startFrame) || 0;
      const viewSpan = Math.max(1e-9, (Number(state.endFrame) || frames) - viewStart);
      return Math.max(0, Math.min(1, (viewStart + x * viewSpan) / frames));
    }
    return x;
  };
  let drag = null;

  const move = (event) => {
    if (!drag || (drag.pointerId !== null && event.pointerId !== drag.pointerId)) {
      return;
    }
    drag.value = phaseAt(drag.surface, event);
    nodeGraphAudioPlayerPlaylistApplyScrub(drag.nodeId, drag.value, { record: false, commit: false });
    event.preventDefault();
    event.stopPropagation();
  };
  const end = (event) => {
    if (!drag || (drag.pointerId !== null && event.pointerId !== undefined && event.pointerId !== drag.pointerId)) {
      return;
    }
    const done = drag;
    drag = null;
    nodeGraphMvp.musicPlayerWaveSeekDragging = false;
    done.surface.classList.remove("value-dragging");
    document.body.classList.remove("node-slider-dragging");
    try {
      if (done.pointerId !== null && done.surface.hasPointerCapture?.(done.pointerId)) {
        done.surface.releasePointerCapture(done.pointerId);
      }
    } catch (_error) {
      // ignore
    }
    if (event.type !== "pointercancel") {
      nodeGraphAudioPlayerPlaylistApplyScrub(done.nodeId, done.value, { record: true, commit: true });
    }
  };

  section.addEventListener("pointerdown", (event) => {
    const surface = surfaceFor(event.target);
    if (!surface || event.button > 0 || event.detail > 1 || drag) {
      return;
    }
    if (event.target.closest?.("button, input, select, textarea, a, [contenteditable]")) {
      return;
    }
    const waveCanvas = surface.querySelector("canvas.node-sample-waveform-canvas");
    if (waveCanvas && typeof nodeGraphSampleWaveformHudHit === "function"
      && nodeGraphSampleWaveformHudHit(section, waveCanvas, event.clientX, event.clientY)) {
      return;
    }
    // Shift-drag (relative phase nudge), Alt-drag (view pan) and the start/end
    // region handles keep the waveform canvas's own gestures.
    if (event.shiftKey || event.altKey) {
      return;
    }
    if (waveCanvas && typeof nodeGraphSampleWaveformRegionHandleHit === "function"
      && nodeGraphSampleWaveformRegionHandleHit(section, waveCanvas, event.clientX)) {
      return;
    }
    if (nodeGraphMvp.sliderDragging || nodeGraphMvp.musicPlayerWaveSeekDragging) {
      return;
    }
    if (typeof nodeGraphPatchIsLocked === "function" && nodeGraphPatchIsLocked()) {
      return;
    }
    const id = idFor();
    if (!id) {
      return;
    }
    const hit = surface.querySelector?.("canvas.node-sample-waveform-canvas") || surface;
    const rect = hit.getBoundingClientRect();
    const x01 = rect.width > 0 ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 0;
    if (typeof nodeGraphSampleWaveformNoteClick === "function") {
      nodeGraphSampleWaveformNoteClick(id, x01, section);
    }
    drag = { nodeId: id, surface, pointerId: event.pointerId ?? null, value: phaseAt(surface, event) };
    nodeGraphMvp.musicPlayerWaveSeekDragging = true;
    surface.classList.add("value-dragging");
    document.body.classList.add("node-slider-dragging");
    nodeGraphAudioPlayerPlaylistApplyScrub(id, drag.value, { record: false, commit: false });
    if (event.pointerId !== undefined) {
      try {
        surface.setPointerCapture(event.pointerId);
      } catch (_error) {
        // ignore
      }
    }
    event.preventDefault();
    event.stopPropagation();
  }, true);
  // Capture phase: runs before the canvas's own handlers, which would pan.
  section.addEventListener("pointermove", move, true);
  section.addEventListener("pointerup", end, true);
  section.addEventListener("pointercancel", end, true);
  section.addEventListener("lostpointercapture", end, true);
}

/**
 * Music Player button labels (transport glyphs, page tabs) fill their own button:
 * the largest font whose text fits the button box with a ~9% inner margin, per
 * button. Sizes come from offsetWidth/offsetHeight, i.e. zoom-1 layout px, so the
 * workspace zoom and the canvas whole-module scale only scale them uniformly.
 * Re-fit when a button's layout box or its label changes.
 */
const NODE_GRAPH_AUDIO_PLAYER_LABEL_SELECTOR = ".node-music-player-pl-transport-btn, .node-music-player-page-btn";
const NODE_GRAPH_AUDIO_PLAYER_LABEL_FILL = 0.82; // 1 - 2 x 9% margin
// Page-button row (wave/waveplay/playlist/playinfo/XY/LR): ONE fixed zoom-1 size for
// every label; a label too wide for its box tightens letter-spacing (never the size).
const NODE_GRAPH_AUDIO_PLAYER_PAGE_LABEL_PX = 11.5;
const NODE_GRAPH_AUDIO_PLAYER_PAGE_LABEL_FILL = 0.94;
let nodeGraphAudioPlayerLabelCtx = null;
let nodeGraphAudioPlayerLabelResize = null;
let nodeGraphAudioPlayerLabelMutate = null;

function nodeGraphAudioPlayerFitLabel(btn) {
  if (!(btn instanceof HTMLElement)) {
    return;
  }
  const w = btn.clientWidth;
  const h = btn.clientHeight;
  const text = String(btn.textContent || "").trim();
  if (!(w > 0 && h > 0) || !text) {
    return;
  }
  const cs = window.getComputedStyle(btn);
  if (!nodeGraphAudioPlayerLabelCtx) {
    nodeGraphAudioPlayerLabelCtx = document.createElement("canvas").getContext("2d");
  }
  // Same ink-box approach as the canvas labels (paint-helpers / number readout):
  // size and center on measureText actualBoundingBox*, not on line metrics, so
  // glyphs like ▶ ⏹ ⏸ 🔁 🔀 sit in the middle of their button.
  const ctx = nodeGraphAudioPlayerLabelCtx;
  const U = 100;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${U}px ${cs.fontFamily}`;
  const m = ctx.measureText(text);
  const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);
  const inkL = num(m.actualBoundingBoxLeft, 0);
  const inkR = num(m.actualBoundingBoxRight, m.width);
  const inkA = num(m.actualBoundingBoxAscent, U * 0.8);
  const inkD = num(m.actualBoundingBoxDescent, U * 0.2);
  const fontA = num(m.fontBoundingBoxAscent, inkA);
  const fontD = num(m.fontBoundingBoxDescent, inkD);
  const inkW = Math.max(1, inkL + inkR);
  const inkH = Math.max(1, inkA + inkD);
  const byWidth = (w * NODE_GRAPH_AUDIO_PLAYER_LABEL_FILL * U) / Math.max(inkW, m.width * 0.98);
  const byInkH = (h * NODE_GRAPH_AUDIO_PLAYER_LABEL_FILL * U) / inkH;
  const isPage = btn.classList.contains("node-music-player-page-btn");
  const px = isPage
    ? NODE_GRAPH_AUDIO_PLAYER_PAGE_LABEL_PX
    : Math.max(4, Math.floor(Math.min(byWidth, byInkH) * 10) / 10);
  const k = px / U;
  let ls = 0; // px letter-spacing (page row only)
  if (isPage) {
    const gaps = Math.max(1, Array.from(text).length);
    const over = Math.max(inkW, m.width) * k - w * NODE_GRAPH_AUDIO_PLAYER_PAGE_LABEL_FILL;
    if (over > 0) ls = -Math.min(over / gaps, px * 0.12);
  }
  // line-height = the button height, so the content area is centered in it. Shift
  // by the gap between the content-area center and the ink center (and same in x).
  const dy = ((fontA - fontD) - (inkA - inkD)) / 2 * k; // + = ink sits low
  // trailing letter-spacing after the last glyph shifts the ink left by ls/2
  const dx = ((inkR - inkL) / 2 - m.width / 2) * k + ls / 2; // + = ink sits right
  const key = `${px}|${ls.toFixed(2)}|${dx.toFixed(2)}|${dy.toFixed(2)}|${h}`;
  // A canvas re-open restores the face's saved inline styles, so trust the style too.
  if (btn.dataset.labelFit === key && btn.style.fontSize === `${px}px`) {
    return;
  }
  btn.dataset.labelFit = key;
  const st = btn.style;
  st.setProperty("font-size", `${px}px`, "important");
  st.setProperty("letter-spacing", `${ls.toFixed(2)}px`, "important");
  st.setProperty("line-height", `${Math.max(1, h - Math.abs(dy) * 2).toFixed(2)}px`, "important");
  st.setProperty("padding-top", `${Math.max(0, -dy * 2).toFixed(2)}px`, "important");
  st.setProperty("padding-bottom", `${Math.max(0, dy * 2).toFixed(2)}px`, "important");
  st.setProperty("padding-left", `${Math.max(0, -dx * 2).toFixed(2)}px`, "important");
  st.setProperty("padding-right", `${Math.max(0, dx * 2).toFixed(2)}px`, "important");
}

function nodeGraphAudioPlayerFitSectionLabels(section) {
  if (!(section instanceof Element)) {
    return;
  }
  if (!nodeGraphAudioPlayerLabelResize && typeof ResizeObserver === "function") {
    nodeGraphAudioPlayerLabelResize = new ResizeObserver((entries) => {
      for (const entry of entries) nodeGraphAudioPlayerFitLabel(entry.target);
    });
  }
  if (!nodeGraphAudioPlayerLabelMutate && typeof MutationObserver === "function") {
    nodeGraphAudioPlayerLabelMutate = new MutationObserver((records) => {
      const seen = new Set();
      for (const record of records) {
        const btn = (record.target.nodeType === 1 ? record.target : record.target.parentElement)
          ?.closest?.(NODE_GRAPH_AUDIO_PLAYER_LABEL_SELECTOR);
        if (btn && !seen.has(btn)) {
          seen.add(btn);
          nodeGraphAudioPlayerFitLabel(btn);
        }
      }
    });
  }
  for (const btn of section.querySelectorAll(NODE_GRAPH_AUDIO_PLAYER_LABEL_SELECTOR)) {
    if (!btn._labelFitWatched) {
      btn._labelFitWatched = true;
      nodeGraphAudioPlayerLabelResize?.observe(btn);
      nodeGraphAudioPlayerLabelMutate?.observe(btn, { childList: true, characterData: true, subtree: true });
    }
    nodeGraphAudioPlayerFitLabel(btn);
  }
}

// Playlist row waveform path (Playlist stays 2D: approved exception).
function nodeGraphAudioPlayerPlaylistStrokeVectorPath(context, points) {
  const count = points.length;
  if (count < 2) {
    return false;
  }
  context.beginPath();
  context.moveTo(points[0], points[1]);
  if (count === 2) {
    // Single sample in view - tiny tick so it still inks.
    context.lineTo(points[0], points[1] + 0.5);
    return true;
  }
  for (let i = 2; i < count; i += 2) {
    context.lineTo(points[i], points[i + 1]);
  }
  return true;
}
