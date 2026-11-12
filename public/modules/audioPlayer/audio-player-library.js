// Music Player folder library: catalog is names/sizes only.
// Visible playlist is a 100-track window. Decode only the playing file.
// Shuffle applies when filling the next window, never while playing it.

var NODE_GRAPH_AUDIO_PLAYER_LIBRARY_WINDOW = 100;

const NODE_GRAPH_AUDIO_PLAYER_FORMATS = Object.freeze([
  { id: "wav", label: "wav", exts: Object.freeze([".wav", ".wave"]) },
  { id: "mp3", label: "mp3", exts: Object.freeze([".mp3"]) },
  { id: "ogg", label: "ogg", exts: Object.freeze([".ogg", ".oga"]) },
  { id: "flac", label: "flac", exts: Object.freeze([".flac"]) },
  { id: "m4a", label: "m4a", exts: Object.freeze([".m4a"]) },
  { id: "aac", label: "aac", exts: Object.freeze([".aac"]) },
  { id: "opus", label: "opus", exts: Object.freeze([".opus"]) },
]);

function nodeGraphAudioPlayerLibraryNormalizeFormats(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const next = {};
  for (const fmt of NODE_GRAPH_AUDIO_PLAYER_FORMATS) {
    const v = src[fmt.id];
    next[fmt.id] = v !== false && v !== "false" && v !== 0;
  }
  return next;
}

function nodeGraphAudioPlayerLibraryFileMatchesFormats(name, formats) {
  const lower = String(name || "").trim().toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot) : "";
  const enabled = nodeGraphAudioPlayerLibraryNormalizeFormats(formats);
  for (const fmt of NODE_GRAPH_AUDIO_PLAYER_FORMATS) {
    if (enabled[fmt.id] && fmt.exts.includes(ext)) {
      return true;
    }
  }
  return false;
}

function nodeGraphAudioPlayerLibraryFolderFileLists() {
  if (!globalThis.nodeGraphAudioPlayerLibraryFolderFileListMap) {
    globalThis.nodeGraphAudioPlayerLibraryFolderFileListMap = new Map();
  }
  return globalThis.nodeGraphAudioPlayerLibraryFolderFileListMap;
}

function nodeGraphAudioPlayerLibraryLooksLikeOsPath(path) {
  const p = String(path || "").trim();
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\\\");
}

function nodeGraphAudioPlayerLibraryStoredFolderPath(path) {
  const p = String(path || "").trim();
  return nodeGraphAudioPlayerLibraryLooksLikeOsPath(p) ? p : "";
}

function nodeGraphAudioPlayerLibraryLooksLikeAudioFilePath(path) {
  const p = nodeGraphAudioPlayerLibraryStoredFolderPath(path);
  if (!p) {
    return false;
  }
  const lower = p.toLowerCase();
  const formats = typeof NODE_GRAPH_AUDIO_PLAYER_FORMATS !== "undefined"
    ? NODE_GRAPH_AUDIO_PLAYER_FORMATS
    : [];
  for (const fmt of formats) {
    for (const ext of fmt.exts || []) {
      if (lower.endsWith(String(ext).toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}

function nodeGraphAudioPlayerLibraryParentDir(path) {
  const p = String(path || "").replace(/[\\/]+$/, "");
  const slash = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  if (slash <= 0) {
    return "";
  }
  // Keep Windows drive root like C:\
  if (/^[a-zA-Z]:$/.test(p.slice(0, slash))) {
    return `${p.slice(0, slash)}\\`;
  }
  return p.slice(0, slash);
}

function nodeGraphAudioPlayerLog(level, message, extra) {
  const text = extra !== undefined
    ? `[music-player] ${message} ${JSON.stringify(extra)}`
    : `[music-player] ${message}`;
  try {
    const se = typeof window !== "undefined" ? window.SE : null;
    if (level === "FAIL") {
      if (typeof se?.FAIL === "function") {
        se.FAIL(text);
      }
    } else if (typeof se?.LIVE === "function") {
      se.LIVE(text);
    } else if (typeof se?.INFO === "function") {
      se.INFO(text);
    }
  } catch (_error) {
    // ignore
  }
  try {
    if (level === "FAIL") {
      console.error(text);
    } else {
      console.info(text);
    }
  } catch (_error) {
    // ignore
  }
}

function nodeGraphAudioPlayerLibraryReport(nodeId, message) {
  const text = String(message || "").trim();
  if (!text) {
    return;
  }
  if (typeof setNodeGraphSampleStatus === "function") {
    setNodeGraphSampleStatus(nodeId, text);
  }
  if (typeof setNodeInteractionHelp === "function") {
    setNodeInteractionHelp(text);
  }
}

function nodeGraphAudioPlayerLibraryWindowSize() {
  const n = Number(NODE_GRAPH_AUDIO_PLAYER_LIBRARY_WINDOW);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 100;
}

function nodeGraphAudioPlayerLibraryShuffleTake(list, count) {
  const pool = Array.isArray(list) ? list.slice() : [];
  const want = Math.max(0, Math.min(pool.length, Math.round(nodeGraphFiniteNumber(count))));
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = pool[i];
    pool[i] = pool[j];
    pool[j] = swap;
  }
  return pool.slice(0, want);
}

function nodeGraphAudioPlayerLibraryPickWindow(catalog, usedPaths, size, shuffle) {
  const all = Array.isArray(catalog) ? catalog.filter((file) => file && file.path) : [];
  const used = new Set((Array.isArray(usedPaths) ? usedPaths : []).map((path) => String(path || "")));
  used.delete("");
  let unused = all.filter((file) => !used.has(file.path));
  let wrapped = false;
  if (!unused.length && all.length) {
    unused = all.slice();
    used.clear();
    wrapped = true;
  }
  const want = Math.max(1, Math.round(Number(size) || nodeGraphAudioPlayerLibraryWindowSize()));
  const picked = shuffle
    ? nodeGraphAudioPlayerLibraryShuffleTake(unused, want)
    : unused.slice(0, want);
  const nextUsed = [...used, ...picked.map((file) => file.path)];
  return { items: picked, used: nextUsed, wrapped };
}

function nodeGraphAudioPlayerLibraryFileKey(file) {
  if (!file) {
    return "";
  }
  const name = String(file.name || "").trim();
  const size = Math.max(0, Math.round(nodeGraphFiniteNumber(file.size)));
  const stamp = Math.max(0, Math.round(nodeGraphFiniteNumber(file.lastModified)));
  return `${name}:${size}:${stamp}`;
}

function nodeGraphAudioPlayerLibraryCatalogs() {
  if (!globalThis.nodeGraphAudioPlayerLibraryCatalogMap) {
    globalThis.nodeGraphAudioPlayerLibraryCatalogMap = new Map();
  }
  return globalThis.nodeGraphAudioPlayerLibraryCatalogMap;
}

function nodeGraphAudioPlayerLibraryFiles() {
  if (typeof nodeGraphSampleFileStore === "function") {
    return nodeGraphSampleFileStore();
  }
  if (!globalThis.nodeGraphAudioPlayerLibraryFileMap) {
    globalThis.nodeGraphAudioPlayerLibraryFileMap = new Map();
  }
  return globalThis.nodeGraphAudioPlayerLibraryFileMap;
}

function nodeGraphAudioPlayerLibraryPlayTokens() {
  if (!globalThis.nodeGraphAudioPlayerLibraryPlayTokenMap) {
    globalThis.nodeGraphAudioPlayerLibraryPlayTokenMap = new Map();
  }
  return globalThis.nodeGraphAudioPlayerLibraryPlayTokenMap;
}

function nodeGraphAudioPlayerLibraryNormalizeCard(raw, index = 0) {
  const source = raw && typeof raw === "object" ? raw : {};
  const path = String(source.path || source.sourcePath || "").trim();
  const fileKey = String(source.fileKey || "").trim();
  // Web-addressed entry (docs/EMBED.md): http(s) URL fetched on play.
  const url = /^https?:\/\//i.test(String(source.url || "").trim()) ? String(source.url).trim() : "";
  const urlName = url ? decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() || "") : "";
  const name = String(source.name || source.rel || path.split(/[\\/]/).pop() || urlName || fileKey || `track-${index + 1}`)
    .trim()
    .slice(0, 220);
  const rel = String(source.rel || "").trim().replace(/\\/g, "/");
  const label = (rel && rel.includes("/") ? rel : name).slice(0, 220) || name;
  const sampleId = String(source.sampleId || "").trim();
  if (!path && !fileKey && !sampleId && !url) {
    return null;
  }
  // Lazy host playlist entry (audio-player-api.js loading:"lazy"): bytes come from the host on play.
  const hostIndex = Math.round(Number(source.hostIndex));
  const host = Number.isFinite(hostIndex) && hostIndex >= 0 && source.hostGen != null
    ? { hostIndex, hostGen: source.hostGen }
    : {};
  return {
    ...(url ? { url } : {}),
    ...host,
    bytes: Math.max(0, Math.round(nodeGraphFiniteNumber(source.bytes))),
    channels: Math.max(0, Math.round(nodeGraphFiniteNumber(source.channels))),
    fileKey,
    frames: Math.max(0, Math.round(nodeGraphFiniteNumber(source.frames))),
    id: String(source.id || `pl-${index}-${label}`).slice(0, 80),
    name: label || name,
    path,
    sampleId,
    sampleRate: Math.max(0, Math.round(nodeGraphFiniteNumber(source.sampleRate))),
  };
}

function nodeGraphAudioPlayerLibrarySetCatalog(nodeId, files) {
  const cards = (Array.isArray(files) ? files : [])
    .map((file, index) => nodeGraphAudioPlayerLibraryNormalizeCard(file, index))
    .filter(Boolean);
  nodeGraphAudioPlayerLibraryCatalogs().set(String(nodeId), cards);
  return cards;
}

function nodeGraphAudioPlayerLibraryCatalog(nodeId) {
  return nodeGraphAudioPlayerLibraryCatalogs().get(String(nodeId)) || [];
}

function nodeGraphAudioPlayerLibraryFillWindow(nodeId, { persist = true, refresh = true } = {}) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return null;
  }
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  const catalog = nodeGraphAudioPlayerLibraryCatalog(nodeId);
  const picked = nodeGraphAudioPlayerLibraryPickWindow(
    catalog,
    pl.used,
    nodeGraphAudioPlayerLibraryWindowSize(),
    Boolean(pl.shuffle),
  );
  pl.items = picked.items.map((file, index) => nodeGraphAudioPlayerLibraryNormalizeCard(file, index));
  pl.used = picked.used;
  pl.index = 0;
  pl.selectedIndex = 0;
  node.playlist = pl;
  if (typeof nodeGraphAudioPlayerPlaylistEnsureCurrentSample === "function") {
    nodeGraphAudioPlayerPlaylistEnsureCurrentSample(nodeId, { persist: false, refresh: false });
  }
  if (refresh && typeof nodeGraphAudioPlayerPlaylistRefreshUi === "function") {
    nodeGraphAudioPlayerPlaylistRefreshUi(nodeId);
  }
  if (persist && typeof nodeGraphAudioPlayerPlaylistPersist === "function") {
    nodeGraphAudioPlayerPlaylistPersist(nodeId);
  }
  return pl;
}

function nodeGraphAudioPlayerLibraryReleaseOrphans(nodeId, keepId = "") {
  const keep = typeof normalizeNodeGraphSampleId === "function"
    ? normalizeNodeGraphSampleId(keepId)
    : String(keepId || "").trim();
  const patch = nodeGraphMvp?.patch;
  const nodes = Array.isArray(patch?.nodes) ? patch.nodes : [];
  const held = new Set();
  if (keep) {
    held.add(keep);
  }
  for (const other of nodes) {
    if (!other || other.id === nodeId) {
      continue;
    }
    const sid = typeof normalizeNodeGraphSampleId === "function"
      ? normalizeNodeGraphSampleId(other.sample?.id)
      : String(other.sample?.id || "").trim();
    if (sid) {
      held.add(sid);
    }
  }
  const pl = typeof nodeGraphAudioPlayerPlaylistForNode === "function"
    ? nodeGraphAudioPlayerPlaylistForNode(nodeId)
    : null;
  if (pl) {
    for (const item of pl.items) {
      const sid = String(item.sampleId || "").trim();
      if (sid && sid !== keep) {
        item.sampleId = "";
        item.frames = 0;
        item.sampleRate = 0;
        item.channels = 0;
      }
    }
  }
  const samples = Array.isArray(patch?.samples) ? patch.samples : [];
  if (patch) {
    patch.samples = samples.filter((sample) => {
      const sid = typeof normalizeNodeGraphSampleId === "function"
        ? normalizeNodeGraphSampleId(sample?.id)
        : String(sample?.id || "").trim();
      if (!sid || held.has(sid)) {
        return true;
      }
      nodeGraphMvp?.sampleBuffers?.delete?.(sid);
      return false;
    });
  }
}

async function nodeGraphAudioPlayerLibraryListFolder(folderPath, { dive = false } = {}) {
  let response;
  try {
    response = await fetch("/api/audio-file/list", {
      body: JSON.stringify({ dive: Boolean(dive), path: folderPath, recursive: Boolean(dive) }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch (error) {
    throw new Error(
      `local folder API unreachable (${String(error?.message || error || "network")}). `
      + "On soundemote.io use Browse (📂), or run python server.py locally for pasted C:\\ paths.",
    );
  }
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const raw = await response.text();
  let payload = {};
  if (contentType.includes("json") || /^\s*[{[]/.test(raw)) {
    try {
      payload = JSON.parse(raw);
    } catch (_error) {
      payload = {};
    }
  }
  if (!contentType.includes("json") || typeof payload?.ok !== "boolean") {
    throw new Error(
      "folder list needs local python server.py (pasted paths). "
      + "On soundemote.io/sandbox use Browse (📂) instead.",
    );
  }
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `folder list failed (${response.status})`);
  }
  return payload;
}

// File -> its FileSystemFileHandle (when picked through the File System Access
// pickers), so a played file's handle can be remembered for after a refresh.
const nodeGraphAudioPlayerFileHandles = new WeakMap();

async function nodeGraphAudioPlayerLibraryCollectDirectoryHandle(dirHandle, {
  dive = false,
  prefix = "",
} = {}) {
  const out = [];
  if (!dirHandle?.entries) {
    return out;
  }
  for await (const [name, handle] of dirHandle.entries()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") {
      try {
        const file = await handle.getFile();
        nodeGraphAudioPlayerFileHandles.set(file, handle);
        out.push(file);
      } catch (_error) {
        // skip unreadable entries
      }
      continue;
    }
    if (handle.kind === "directory" && dive) {
      const nested = await nodeGraphAudioPlayerLibraryCollectDirectoryHandle(handle, {
        dive: true,
        prefix: rel,
      });
      out.push(...nested);
    }
  }
  return out;
}

function nodeGraphAudioPlayerLibraryPickFolderViaInput({ dive = false } = {}) {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "audio/*,.wav,.wave,.mp3,.ogg,.oga,.opus,.flac,.m4a,.aac";
    try {
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
    } catch (_error) {
      // ignore
    }
    input.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
    const finish = (files, error) => {
      try {
        input.remove();
      } catch (_error) {
        // ignore
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(files);
    };
    input.addEventListener("change", () => {
      const picked = [...(input.files || [])];
      if (!picked.length) {
        finish([], null);
        return;
      }
      if (dive) {
        finish(picked, null);
        return;
      }
      // webkitdirectory always walks the tree; keep top-level files only when Recursive is off.
      finish(picked.filter((file) => {
        const rel = String(file.webkitRelativePath || file.name || "").replace(/\\/g, "/");
        return rel.split("/").filter(Boolean).length <= 2;
      }), null);
    }, { once: true });
    input.addEventListener("cancel", () => finish([], null), { once: true });
    document.body.appendChild(input);
    try {
      input.click();
    } catch (error) {
      finish([], error);
    }
  });
}

async function nodeGraphAudioPlayerLibraryPickFolderFiles({ dive = false } = {}) {
  if (typeof window !== "undefined" && typeof window.showDirectoryPicker === "function") {
    try {
      // Own picker id: Chrome remembers the last Music Player folder apart
      // from the patch / other pickers.
      const dirHandle = await window.showDirectoryPicker({ mode: "read", id: "soemdspMusicFolder" });
      const files = await nodeGraphAudioPlayerLibraryCollectDirectoryHandle(dirHandle, {
        dive: Boolean(dive),
        prefix: "",
      });
      return {
        files,
        folderName: String(dirHandle?.name || "folder").trim() || "folder",
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        return { files: [], folderName: "", cancelled: true };
      }
      // Fall through to the legacy directory input.
    }
  }
  const files = await nodeGraphAudioPlayerLibraryPickFolderViaInput({ dive: Boolean(dive) });
  if (!files.length) {
    return { files: [], folderName: "", cancelled: true };
  }
  const firstRel = String(files[0]?.webkitRelativePath || "").replace(/\\/g, "/");
  const folderName = firstRel.split("/").filter(Boolean)[0] || "folder";
  return { files, folderName };
}

function nodeGraphAudioPlayerLibraryRememberPickedFiles(nodeId, files) {
  const store = nodeGraphAudioPlayerLibraryFiles();
  const list = [];
  const cards = [];
  for (const file of files || []) {
    if (!file) {
      continue;
    }
    const fileKey = nodeGraphAudioPlayerLibraryFileKey(file)
      || (typeof nodeGraphSampleFileKeyFromFile === "function"
        ? nodeGraphSampleFileKeyFromFile(file)
        : "");
    if (!fileKey) {
      continue;
    }
    store.set(fileKey, file);
    const rel = String(file.webkitRelativePath || file.name || "").replace(/\\/g, "/");
    const path = rel || file.name || fileKey;
    list.push(file);
    cards.push({
      bytes: Math.max(0, Math.round(nodeGraphFiniteNumber(file.size))),
      fileKey,
      name: file.name || path.split("/").pop() || fileKey,
      path: `browser:${path}`,
      rel,
    });
  }
  nodeGraphAudioPlayerLibraryFolderFileLists().set(String(nodeId), list);
  return cards;
}

async function nodeGraphAudioPlayerLibraryBindPickedFolder(nodeId, { dive = null, persist = true } = {}) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return null;
  }
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  const recursive = dive == null ? Boolean(pl.folderDive) : Boolean(dive);
  const picked = await nodeGraphAudioPlayerLibraryPickFolderFiles({ dive: recursive });
  if (picked.cancelled) {
    nodeGraphAudioPlayerLibraryReport(nodeId, "Browse cancelled");
    return null;
  }
  const matched = (picked.files || []).filter((file) =>
    nodeGraphAudioPlayerLibraryFileMatchesFormats(file.name || file.webkitRelativePath, pl.formats),
  );
  if (!matched.length) {
    throw new Error(
      recursive
        ? "folder has no matching audio"
        : "folder has no matching audio (try Recursive search)",
    );
  }
  const cards = nodeGraphAudioPlayerLibraryRememberPickedFiles(nodeId, matched);
  // Browser picks cannot rehydrate from a pasted OS path later.
  pl.folderPath = "";
  nodeGraphAudioPlayerLibraryBindCards(nodeId, cards, {
    folderDive: recursive,
    folderPath: "",
    persist,
  });
  const pathBox = document.querySelector(
    `.node-sample-path-input[data-sample-path-for-node="${CSS.escape(String(nodeId))}"]`,
  );
  if (pathBox && document.activeElement !== pathBox) {
    pathBox.value = picked.folderName ? `${picked.folderName} (browser)` : "";
    pathBox.title = "Loaded from Browse — use Browse again to change folders online";
  }
  if (typeof setNodeGraphSampleStatus === "function") {
    setNodeGraphSampleStatus(
      nodeId,
      `${Math.min(cards.length, nodeGraphAudioPlayerLibraryWindowSize())} of ${cards.length} listed`,
    );
  }
  nodeGraphAudioPlayerLog("INFO", "listed via browse", {
    nodeId,
    tracks: cards.length,
    folder: picked.folderName || "",
  });
  return { files: cards, folderName: picked.folderName || "" };
}

async function nodeGraphAudioPlayerLibraryBrowseFolder(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    nodeGraphAudioPlayerLibraryReport(nodeId, "Browse: no Music Player selected");
    return null;
  }
  try {
    const result = await nodeGraphAudioPlayerLibraryBindPickedFolder(nodeId);
    if (!result) {
      return null;
    }
    if (typeof nodeGraphAudioPlayerPlaylistSetFace === "function") {
      nodeGraphAudioPlayerPlaylistSetFace(nodeId, "pl");
    }
    const loaded = nodeGraphAudioPlayerPlaylistForNode(nodeId);
    const transport = typeof nodeGraphAudioPlayerTransportBase === "function"
      ? nodeGraphAudioPlayerTransportBase(nodeId)
      : 0;
    if ((loaded?.items?.length || 0) > 0 && transport >= 3) {
      nodeGraphAudioPlayerLibraryPlayIndex(nodeId, loaded.index || 0, { autoplay: true }).catch((error) => {
        nodeGraphAudioPlayerLog("FAIL", String(error?.message || error || "autostart failed"));
      });
    }
    return loaded;
  } catch (error) {
    const message = String(error?.message || error || "browse failed");
    nodeGraphAudioPlayerLog("FAIL", message, { nodeId });
    nodeGraphAudioPlayerLibraryReport(nodeId, message);
    return null;
  }
}

function nodeGraphAudioPlayerLibraryBindCards(nodeId, files, extras = {}) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return null;
  }
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  pl.folderPath = nodeGraphAudioPlayerLibraryStoredFolderPath(extras.folderPath || pl.folderPath);
  if (Object.prototype.hasOwnProperty.call(extras, "folderDive")) {
    pl.folderDive = Boolean(extras.folderDive);
  }
  pl.used = [];
  const cards = nodeGraphAudioPlayerLibrarySetCatalog(nodeId, files).map((card, index) => {
    card.listNumber = index + 1;
    return card;
  });
  pl.items = cards;
  pl.played = [];
  pl.playing = cards[0] || null;
  pl.unplayed = cards.slice(1);
  if (typeof nodeGraphAudioPlayerPlaylistSyncQueues === "function") {
    nodeGraphAudioPlayerPlaylistSyncQueues(pl);
  } else if (typeof nodeGraphAudioPlayerPlaylistRebuildItems === "function") {
    nodeGraphAudioPlayerPlaylistRebuildItems(pl);
  } else {
    pl.index = 0;
    pl.selectedIndex = 0;
  }
  node.playlist = pl;
  if (extras.refresh !== false && typeof nodeGraphAudioPlayerPlaylistRefreshUi === "function") {
    nodeGraphAudioPlayerPlaylistRefreshUi(nodeId);
  }
  if (extras.persist !== false && typeof nodeGraphAudioPlayerPlaylistPersist === "function") {
    nodeGraphAudioPlayerPlaylistPersist(nodeId);
  }
  nodeGraphAudioPlayerLibraryReport(
    nodeId,
    `${cards.length} track${cards.length === 1 ? "" : "s"} listed (slots only on screen)`,
  );
  return pl;
}

async function nodeGraphAudioPlayerLibraryBindFolder(nodeId, folderPath, { dive = null, persist = true } = {}) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return null;
  }
  const sourcePath = nodeGraphAudioPlayerLibraryStoredFolderPath(folderPath);
  if (!sourcePath) {
    throw new Error("paste a full folder path, then Load Folder");
  }
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  const recursive = dive == null ? Boolean(pl.folderDive) : Boolean(dive);
  const payload = await nodeGraphAudioPlayerLibraryListFolder(sourcePath, { dive: recursive });
  const listed = Array.isArray(payload.files) ? payload.files : [];
  const files = listed.filter((file) =>
    nodeGraphAudioPlayerLibraryFileMatchesFormats(file.name || file.path || file.rel, pl.formats),
  );
  if (!files.length) {
    throw new Error(
      recursive
        ? "folder has no matching audio"
        : "folder has no matching audio (try Recursive search)",
    );
  }
  nodeGraphAudioPlayerLibraryBindCards(nodeId, files, {
    folderDive: recursive,
    folderPath: nodeGraphAudioPlayerLibraryStoredFolderPath(payload.path || sourcePath),
    persist,
  });
  if (typeof setNodeGraphSampleStatus === "function") {
    setNodeGraphSampleStatus(
      nodeId,
      `${Math.min(files.length, nodeGraphAudioPlayerLibraryWindowSize())} of ${files.length} listed`,
    );
  }
  return payload;
}

async function nodeGraphAudioPlayerLibraryLoadPlaylist(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    nodeGraphAudioPlayerLibraryReport(nodeId, "Load Folder: no Music Player selected");
    return null;
  }
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  const pathBox = document.querySelector(
    `.node-sample-path-input[data-sample-path-for-node="${CSS.escape(String(nodeId))}"]`,
  );
  const typed = nodeGraphAudioPlayerLibraryStoredFolderPath(pathBox?.value);
  let folder = typed || nodeGraphAudioPlayerLibraryStoredFolderPath(pl.folderPath);
  if (!folder) {
    // Online / no pasted OS path: Browse is the supported way to list files.
    return nodeGraphAudioPlayerLibraryBrowseFolder(nodeId);
  }
  // Pasted file path → catalog the parent folder (Load File is for one track).
  if (nodeGraphAudioPlayerLibraryLooksLikeAudioFilePath(folder)) {
    const parent = nodeGraphAudioPlayerLibraryParentDir(folder);
    if (!parent) {
      nodeGraphAudioPlayerLibraryReport(nodeId, "Load Folder: could not resolve parent folder");
      return pl;
    }
    folder = parent;
  }
  pl.folderPath = folder;
  node.playlist = pl;
  try {
    await nodeGraphAudioPlayerLibraryBindFolder(nodeId, folder);
  } catch (error) {
    const message = String(error?.message || error || "load failed");
    nodeGraphAudioPlayerLog("FAIL", message, { nodeId, folder });
    nodeGraphAudioPlayerLibraryReport(nodeId, message);
    return pl;
  }
  const loaded = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  if (pathBox && document.activeElement !== pathBox) {
    pathBox.value = loaded?.folderPath || folder;
  }
  if (typeof nodeGraphAudioPlayerPlaylistSetFace === "function") {
    nodeGraphAudioPlayerPlaylistSetFace(nodeId, "pl");
  }
  const transport = typeof nodeGraphAudioPlayerTransportBase === "function"
    ? nodeGraphAudioPlayerTransportBase(nodeId)
    : 0;
  nodeGraphAudioPlayerLog("INFO", "listed", {
    nodeId,
    tracks: loaded?.items?.length || 0,
    folder: loaded?.folderPath || folder,
    transport,
  });
  if ((loaded?.items?.length || 0) > 0 && transport >= 3) {
    nodeGraphAudioPlayerLog("INFO", "autostart after load (Playmode already on)");
    nodeGraphAudioPlayerLibraryPlayIndex(nodeId, loaded.index || 0, { autoplay: true }).catch((error) => {
      nodeGraphAudioPlayerLog("FAIL", String(error?.message || error || "autostart failed"));
    });
  }
  return loaded;
}

function nodeGraphAudioPlayerLibraryPickAudioFileViaInput() {
  return nodeGraphAudioPlayerLibraryPickAudioFilesViaInput();
}

function nodeGraphAudioPlayerLibraryPickAudioFilesViaInput() {
  const acceptList = [".wav", ".wave", ".mp3", ".ogg", ".oga", ".opus", ".flac", ".m4a", ".aac"];
  const viaHandle = async () => {
    if (typeof window.showOpenFilePicker !== "function") {
      return null;
    }
    try {
      // Own picker id (not the shared patch start folder): Chrome reopens the
      // last folder music was loaded from, and opening patches is unaffected.
      const handles = await window.showOpenFilePicker({
        multiple: true,
        id: "soemdspMusicFiles",
        types: [{
          description: "Audio",
          accept: { "audio/*": acceptList },
        }],
        excludeAcceptAllOption: false,
      });
      const files = [];
      for (const handle of handles || []) {
        try {
          const file = await handle.getFile();
          if (file) {
            nodeGraphAudioPlayerFileHandles.set(file, handle);
            files.push(file);
          }
        } catch (_error) {
          // skip unreadable
        }
      }
      return { cancelled: !files.length && !(handles || []).length, files };
    } catch (error) {
      if (error && (error.name === "AbortError" || error.name === "NotAllowedError")) {
        return { cancelled: true, files: [] };
      }
      throw error;
    }
  };
  return viaHandle().then((picked) => {
    if (picked) {
      return picked;
    }
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept = "audio/*,.wav,.wave,.mp3,.ogg,.oga,.opus,.flac,.m4a,.aac";
      input.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
      const finish = (files, error, cancelled = false) => {
        try {
          input.remove();
        } catch (_error) {
          // ignore
        }
        if (error) {
          reject(error);
          return;
        }
        resolve({ cancelled, files: Array.isArray(files) ? files : [] });
      };
      input.addEventListener("change", () => {
        const picked = [...(input.files || [])];
        finish(picked, null, !picked.length);
      }, { once: true });
      input.addEventListener("cancel", () => finish([], null, true), { once: true });
      document.body.appendChild(input);
      try {
        input.click();
      } catch (error) {
        finish([], error, false);
      }
    });
  });
}

async function nodeGraphAudioPlayerLibraryLoadFile(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    nodeGraphAudioPlayerLibraryReport(nodeId, "Load File: no Music Player selected");
    return null;
  }
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  const pathBox = document.querySelector(
    `.node-sample-path-input[data-sample-path-for-node="${CSS.escape(String(nodeId))}"]`,
  );
  const typed = nodeGraphAudioPlayerLibraryStoredFolderPath(pathBox?.value);
  // Pasted OS audio path → load that file. Otherwise open the native picker.
  if (typed && nodeGraphAudioPlayerLibraryLooksLikeAudioFilePath(typed)) {
    let files = [];
    try {
      const payload = await nodeGraphAudioPlayerLibraryListFolder(typed, { dive: false });
      files = Array.isArray(payload.files) ? payload.files : [];
    } catch (error) {
      files = [{
        bytes: 0,
        name: typed.split(/[\\/]/).pop() || typed,
        path: typed,
        rel: typed.split(/[\\/]/).pop() || typed,
      }];
      nodeGraphAudioPlayerLog("INFO", "Load File list fallback", {
        nodeId,
        path: typed,
        error: String(error?.message || error || ""),
      });
    }
    const matched = files.filter((file) =>
      nodeGraphAudioPlayerLibraryFileMatchesFormats(file.name || file.path || file.rel, pl.formats),
    );
    if (!matched.length) {
      throw new Error("unsupported or filtered audio file");
    }
    const parent = nodeGraphAudioPlayerLibraryParentDir(typed);
    nodeGraphAudioPlayerLibraryBindCards(nodeId, matched.slice(0, 1), {
      folderDive: false,
      folderPath: parent || typed,
      persist: true,
    });
    if (pathBox && document.activeElement !== pathBox) {
      pathBox.value = typed;
    }
  } else {
    const picked = await nodeGraphAudioPlayerLibraryPickAudioFilesViaInput();
    if (picked.cancelled || !(picked.files || []).length) {
      nodeGraphAudioPlayerLibraryReport(nodeId, "Load File cancelled");
      return null;
    }
    const matched = (picked.files || []).filter((file) =>
      nodeGraphAudioPlayerLibraryFileMatchesFormats(file.name, pl.formats),
    );
    if (!matched.length) {
      throw new Error("unsupported or filtered audio file");
    }
    const cards = nodeGraphAudioPlayerLibraryRememberPickedFiles(nodeId, matched);
    if (!cards.length) {
      throw new Error("could not register picked file");
    }
    nodeGraphAudioPlayerLibraryBindCards(nodeId, cards, {
      folderDive: false,
      folderPath: "",
      persist: true,
    });
    if (pathBox && document.activeElement !== pathBox) {
      const first = matched[0]?.name || "audio";
      pathBox.value = matched.length === 1
        ? `${first} (browser)`
        : `${matched.length} files (browser)`;
      pathBox.title = matched.length === 1
        ? "Loaded from Load File — pick again to replace"
        : `Loaded ${matched.length} files in picker order — pick again to replace`;
    }
  }
  const loaded = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  if (typeof nodeGraphAudioPlayerPlaylistSetFace === "function") {
    nodeGraphAudioPlayerPlaylistSetFace(nodeId, "pl");
  }
  const n = loaded?.items?.length || 0;
  const name = loaded?.items?.[0]?.name || "audio";
  nodeGraphAudioPlayerLibraryReport(
    nodeId,
    n <= 1 ? `1 file loaded (${name})` : `${n} files loaded (${name}…)`,
  );
  const transport = typeof nodeGraphAudioPlayerTransportBase === "function"
    ? nodeGraphAudioPlayerTransportBase(nodeId)
    : 0;
  if ((loaded?.items?.length || 0) > 0 && transport >= 3) {
    nodeGraphAudioPlayerLibraryPlayIndex(nodeId, loaded.index || 0, { autoplay: true }).catch((error) => {
      nodeGraphAudioPlayerLog("FAIL", String(error?.message || error || "autostart failed"));
    });
  }
  return loaded;
}

function nodeGraphAudioPlayerLibraryShufflePlaylist(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return null;
  }
  const pl = typeof nodeGraphAudioPlayerPlaylistEnsureQueues === "function"
    ? nodeGraphAudioPlayerPlaylistEnsureQueues(nodeGraphAudioPlayerPlaylistForNode(nodeId))
    : nodeGraphAudioPlayerPlaylistForNode(nodeId);
  const shuffleFn = typeof nodeGraphAudioPlayerPlaylistShuffleArray === "function"
    ? nodeGraphAudioPlayerPlaylistShuffleArray
    : (list) => list;
  const items = Array.isArray(pl.items) ? pl.items : [];
  const playedKeys = typeof nodeGraphAudioPlayerPlaylistPlayedKeySet === "function"
    ? nodeGraphAudioPlayerPlaylistPlayedKeySet(pl)
    : new Set();
  const playingKey = typeof nodeGraphAudioPlayerPlaylistItemKey === "function"
    ? nodeGraphAudioPlayerPlaylistItemKey(pl.playing)
    : "";
  const slots = [];
  const cards = [];
  for (let i = 0; i < items.length; i += 1) {
    const key = typeof nodeGraphAudioPlayerPlaylistItemKey === "function"
      ? nodeGraphAudioPlayerPlaylistItemKey(items[i])
      : "";
    if (key && key !== playingKey && !playedKeys.has(key)) {
      slots.push(i);
      cards.push(items[i]);
    }
  }
  const shuffled = shuffleFn(cards);
  for (let n = 0; n < slots.length; n += 1) {
    items[slots[n]] = shuffled[n];
  }
  pl.items = items;
  if (typeof nodeGraphAudioPlayerPlaylistSyncQueues === "function") {
    nodeGraphAudioPlayerPlaylistSyncQueues(pl);
  } else if (typeof nodeGraphAudioPlayerPlaylistRebuildItems === "function") {
    nodeGraphAudioPlayerPlaylistRebuildItems(pl);
  }
  node.playlist = pl;
  if (typeof nodeGraphAudioPlayerPlaylistRefreshUi === "function") {
    nodeGraphAudioPlayerPlaylistRefreshUi(nodeId);
  }
  if (typeof nodeGraphAudioPlayerPlaylistPersist === "function") {
    nodeGraphAudioPlayerPlaylistPersist(nodeId);
  }
  if (typeof setNodeGraphSampleStatus === "function") {
    setNodeGraphSampleStatus(nodeId, `shuffled ${pl.unplayed.length} unplayed (playing stays #${pl.playing?.listNumber || pl.index + 1})`);
  }
  return pl;
}

function nodeGraphAudioPlayerLibraryCandidateSampleIds(item) {
  const ids = [];
  const push = (value) => {
    const id = typeof normalizeNodeGraphSampleId === "function"
      ? normalizeNodeGraphSampleId(value)
      : String(value || "").trim().replace(/[^A-Za-z0-9_.:-]+/g, "-");
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  };
  push(item?.sampleId);
  push(item?.path);
  push(item?.fileKey);
  const base = String(item?.name || item?.path || "").replace(/\\/g, "/").split("/").pop();
  push(base);
  return ids;
}

function nodeGraphAudioPlayerLibraryFindBufferForItem(item) {
  const buffers = nodeGraphMvp?.sampleBuffers;
  if (!item || !buffers?.get) {
    return null;
  }
  for (const id of nodeGraphAudioPlayerLibraryCandidateSampleIds(item)) {
    const buf = buffers.get(id);
    const frames = Math.max(
      0,
      Number(buf?.frames) || buf?.channelData?.[0]?.length || buf?.samples?.length || 0,
    );
    if (buf && frames > 0) {
      return { buf, frames, id };
    }
  }
  return null;
}

function nodeGraphAudioPlayerLibraryItemLoaded(item) {
  return Boolean(nodeGraphAudioPlayerLibraryFindBufferForItem(item));
}

function nodeGraphAudioPlayerLibraryFindFileForItem(item) {
  if (!item) {
    return null;
  }
  const store = nodeGraphAudioPlayerLibraryFiles();
  const key = String(item.fileKey || "").trim();
  if (key) {
    const held = store.get(key);
    if (held) {
      return held;
    }
  }
  const base = String(item.name || item.path || "").replace(/\\/g, "/").split("/").pop();
  if (!base) {
    return null;
  }
  for (const file of store.values()) {
    if (file && String(file.name || "") === base) {
      return file;
    }
  }
  const lists = typeof nodeGraphAudioPlayerLibraryFolderFileLists === "function"
    ? nodeGraphAudioPlayerLibraryFolderFileLists()
    : null;
  if (lists) {
    for (const list of lists.values()) {
      const found = (list || []).find((file) => String(file?.name || "") === base);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

// ---- Load progress (playlist row fill) ----
// Download progress is real (streamed bytes / Content-Length). Decode gives no
// progress events, so it is estimated from file size x a learned ms-per-MB rate
// (remembered per browser). No rate yet / unknown size -> no fill, blink only.
const NODE_GRAPH_AUDIO_PLAYER_DECODE_RATE_KEY = "soemdsp.musicPlayer.decodeMsPerMb";
const NODE_GRAPH_AUDIO_PLAYER_DOWNLOAD_SHARE = 0.7;

function nodeGraphAudioPlayerLibrarySetLoadProgress(nodeId, frac) {
  if (typeof nodeGraphAudioPlayerPlaylistSetLoadProgress === "function") {
    nodeGraphAudioPlayerPlaylistSetLoadProgress(nodeId, frac);
  }
}

function nodeGraphAudioPlayerLibraryDecodeRate() {
  try {
    const v = Number(window.localStorage.getItem(NODE_GRAPH_AUDIO_PLAYER_DECODE_RATE_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch (_) {
    return 0;
  }
}

function nodeGraphAudioPlayerLibraryLearnDecodeRate(bytes, ms) {
  const mb = bytes / (1024 * 1024);
  if (!(mb >= 0.25) || !(ms > 0)) {
    return;
  }
  const measured = ms / mb;
  const prev = nodeGraphAudioPlayerLibraryDecodeRate();
  const next = prev > 0 ? prev * 0.6 + measured * 0.4 : measured;
  try {
    window.localStorage.setItem(NODE_GRAPH_AUDIO_PLAYER_DECODE_RATE_KEY, String(next));
  } catch (_) {
    // storage blocked: estimate just stays unavailable
  }
}

// Runs the decode/bind and animates the fill from `from` toward 1 by the
// learned rate. Eases out past the estimate so a slow decode never "finishes"
// early; the row clears when the load ends.
async function nodeGraphAudioPlayerLibraryDecodeWithProgress(nodeId, file, options, from = 0) {
  const bytes = Math.max(0, nodeGraphFiniteNumber(file?.size));
  const rate = nodeGraphAudioPlayerLibraryDecodeRate();
  const estimateMs = rate > 0 && bytes > 0 ? rate * (bytes / (1024 * 1024)) : 0;
  const start = performance.now();
  let raf = 0;
  if (estimateMs > 0) {
    const tick = () => {
      const t = (performance.now() - start) / estimateMs;
      const eased = t < 1 ? t * 0.95 : 0.95 + 0.05 * (1 - Math.exp(-(t - 1)));
      nodeGraphAudioPlayerLibrarySetLoadProgress(nodeId, from + (1 - from) * eased);
      raf = window.requestAnimationFrame(tick);
    };
    tick();
  } else if (from <= 0) {
    nodeGraphAudioPlayerLibrarySetLoadProgress(nodeId, undefined);
  }
  try {
    const sample = await loadNodeGraphSampleForNode(nodeId, file, options);
    nodeGraphAudioPlayerLibraryLearnDecodeRate(bytes, performance.now() - start);
    return sample;
  } finally {
    if (raf) {
      window.cancelAnimationFrame(raf);
    }
  }
}

// fetch() + streamed read so the row can fill with real bytes received.
async function nodeGraphAudioPlayerLibraryFetchBlobWithProgress(nodeId, res, share) {
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total) {
    nodeGraphAudioPlayerLibrarySetLoadProgress(nodeId, undefined);
    return res.blob();
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  nodeGraphAudioPlayerLibrarySetLoadProgress(nodeId, 0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    received += value.byteLength;
    nodeGraphAudioPlayerLibrarySetLoadProgress(nodeId, share * Math.min(1, received / total));
  }
  return new Blob(chunks, { type: res.headers.get("content-type") || "" });
}

// ---- Loaded-audio cache (survives a refresh) ----
// A browser forgets picked files on refresh. The bytes of files the Music
// Player decodes are copied into the origin-private file system (OPFS), keyed
// by the playlist item's fileKey, so a refresh reloads them with no prompt.
// Size: the "Music cache" setting (Music Player Display Settings; one value
// for the whole app): Off / 500 MB (default) / 2 / 5 / 10 / 20 GB. Least
// recently played dropped first. Safety net: a write never takes more than
// half of the space the browser says this site may still use
// (navigator.storage.estimate), whatever the setting. Above the default the
// cache asks to be kept (navigator.storage.persist) so the browser does not
// wipe it. Bookkeeping in localStorage.
const NODE_GRAPH_AUDIO_PLAYER_CACHE_DIR = "soemdsp-music-cache";
const NODE_GRAPH_AUDIO_PLAYER_CACHE_META = "soemdsp.musicPlayer.cacheMeta";
const NODE_GRAPH_AUDIO_PLAYER_CACHE_LIMIT_KEY = "soemdsp.musicPlayer.cacheLimit";
const NODE_GRAPH_AUDIO_PLAYER_CACHE_DEFAULT = 500 * 1024 * 1024;
const NODE_GRAPH_AUDIO_PLAYER_CACHE_CHOICES = Object.freeze([
  ["Off", 0], ["500 MB", 500 * 1024 * 1024], ["2 GB", 2 * 1024 ** 3],
  ["5 GB", 5 * 1024 ** 3], ["10 GB", 10 * 1024 ** 3], ["20 GB", 20 * 1024 ** 3],
]);

/** The cache size limit in bytes (0 = off). */
function nodeGraphAudioPlayerCacheLimit() {
  try {
    const raw = window.localStorage.getItem(NODE_GRAPH_AUDIO_PLAYER_CACHE_LIMIT_KEY);
    const n = Number(raw);
    return raw === null || !Number.isFinite(n) || n < 0 ? NODE_GRAPH_AUDIO_PLAYER_CACHE_DEFAULT : n;
  } catch (_e) { return NODE_GRAPH_AUDIO_PLAYER_CACHE_DEFAULT; }
}

/** Bytes the cache holds now. */
function nodeGraphAudioPlayerCacheUsage() {
  return Object.values(nodeGraphAudioPlayerCacheMeta()).reduce((sum, m) => sum + (Number(m?.size) || 0), 0);
}

/** Drop least recently played files until the cache fits `limit` bytes. */
async function nodeGraphAudioPlayerCacheTrim(limit, incoming = 0) {
  const meta = nodeGraphAudioPlayerCacheMeta();
  const dir = await nodeGraphAudioPlayerCacheDir();
  let total = Object.values(meta).reduce((sum, m) => sum + (Number(m?.size) || 0), 0);
  const order = Object.entries(meta).sort((a, b) => (a[1]?.last || 0) - (b[1]?.last || 0));
  while (total + incoming > limit && order.length) {
    const [oldKey, old] = order.shift();
    try { if (dir) await dir.removeEntry(nodeGraphAudioPlayerCacheName(oldKey)); } catch (_e) { /* gone */ }
    total -= Number(old?.size) || 0;
    delete meta[oldKey];
  }
  nodeGraphAudioPlayerCacheSaveMeta(meta);
}

/** Set the limit (bytes; 0 = off): trims to it, and above the default asks to keep the cache. */
async function nodeGraphAudioPlayerCacheSetLimit(bytes) {
  const limit = Math.max(0, Number(bytes) || 0);
  try { window.localStorage.setItem(NODE_GRAPH_AUDIO_PLAYER_CACHE_LIMIT_KEY, String(limit)); } catch (_e) { /* blocked */ }
  await nodeGraphAudioPlayerCacheTrim(limit);
  if (limit > NODE_GRAPH_AUDIO_PLAYER_CACHE_DEFAULT && navigator?.storage?.persist) {
    try { await navigator.storage.persist(); } catch (_e) { /* not granted */ }
  }
}

/** Empty the cache (the Clear button). */
async function nodeGraphAudioPlayerCacheClear() {
  const meta = nodeGraphAudioPlayerCacheMeta();
  const dir = await nodeGraphAudioPlayerCacheDir();
  for (const key of Object.keys(meta)) {
    try { if (dir) await dir.removeEntry(nodeGraphAudioPlayerCacheName(key)); } catch (_e) { /* gone */ }
  }
  nodeGraphAudioPlayerCacheSaveMeta({});
}

function nodeGraphAudioPlayerCacheName(key) {
  let h = 2166136261 >>> 0;
  const s = String(key || "");
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `a${h.toString(16)}_${s.length}`;
}

function nodeGraphAudioPlayerCacheMeta() {
  try { return JSON.parse(window.localStorage.getItem(NODE_GRAPH_AUDIO_PLAYER_CACHE_META) || "{}") || {}; } catch (_e) { return {}; }
}

function nodeGraphAudioPlayerCacheSaveMeta(meta) {
  try { window.localStorage.setItem(NODE_GRAPH_AUDIO_PLAYER_CACHE_META, JSON.stringify(meta)); } catch (_e) { /* storage full / blocked */ }
}

async function nodeGraphAudioPlayerCacheDir() {
  if (!navigator?.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(NODE_GRAPH_AUDIO_PLAYER_CACHE_DIR, { create: true });
  } catch (_e) { return null; }
}

/** Copy a decoded file into the cache (fire and forget). */
async function nodeGraphAudioPlayerCachePut(key, file) {
  const k = String(key || "");
  const size = Math.max(0, Math.round(nodeGraphFiniteNumber(file?.size)));
  const limit = nodeGraphAudioPlayerCacheLimit();
  if (!k || !file || !(size > 0) || size > limit) return;
  const meta = nodeGraphAudioPlayerCacheMeta();
  if (meta[k]) { meta[k].last = Date.now(); nodeGraphAudioPlayerCacheSaveMeta(meta); return; }
  const dir = await nodeGraphAudioPlayerCacheDir();
  if (!dir) return;
  try {
    // Safety net: never more than half of what the browser says is left.
    if (navigator?.storage?.estimate) {
      const est = await navigator.storage.estimate();
      const free = Math.max(0, (Number(est?.quota) || 0) - (Number(est?.usage) || 0));
      if (free > 0 && size > free * 0.5) return;
    }
    // Make room first: least recently played out until this file fits.
    await nodeGraphAudioPlayerCacheTrim(limit, size);
    const meta2 = nodeGraphAudioPlayerCacheMeta();
    const handle = await dir.getFileHandle(nodeGraphAudioPlayerCacheName(k), { create: true });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
    meta2[k] = { size, name: String(file.name || ""), type: String(file.type || ""), last: Date.now() };
    nodeGraphAudioPlayerCacheSaveMeta(meta2);
  } catch (error) {
    nodeGraphAudioPlayerLog("INFO", "music cache write skipped", { error: String(error?.message || error || "") });
  }
}

// Handles of played files (IndexedDB; no audio bytes): files too big for the
// cache, or dropped from it, reload from disk after one "allow" click.
function nodeGraphAudioPlayerHandleDb() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open("soemdsp-music", 1);
      req.onupgradeneeded = () => { req.result.createObjectStore("handles"); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (_e) { resolve(null); }
  });
}

async function nodeGraphAudioPlayerHandlePut(key, handle) {
  const db = await nodeGraphAudioPlayerHandleDb();
  if (!db || !key || !handle) return;
  await new Promise((resolve) => {
    try {
      const tx = db.transaction("handles", "readwrite");
      tx.objectStore("handles").put(handle, String(key));
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    } catch (_e) { resolve(); }
  });
}

async function nodeGraphAudioPlayerHandleGet(key) {
  const db = await nodeGraphAudioPlayerHandleDb();
  if (!db || !key) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction("handles", "readonly").objectStore("handles").get(String(key));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (_e) { resolve(null); }
  });
}

/** A remembered handle's file, asking for read permission if needed (needs a click). */
async function nodeGraphAudioPlayerHandleFile(key, { ask = true } = {}) {
  const handle = await nodeGraphAudioPlayerHandleGet(key);
  if (!handle?.getFile) return null;
  try {
    let perm = typeof handle.queryPermission === "function" ? await handle.queryPermission({ mode: "read" }) : "granted";
    if (perm !== "granted" && ask && typeof handle.requestPermission === "function") {
      perm = await handle.requestPermission({ mode: "read" });
    }
    if (perm !== "granted") return null;
    return await handle.getFile();
  } catch (_e) { return null; }
}

/** The cached file for a fileKey, or null. */
async function nodeGraphAudioPlayerCacheGet(key) {
  const k = String(key || "");
  const meta = nodeGraphAudioPlayerCacheMeta();
  if (!k || !meta[k]) return null;
  const dir = await nodeGraphAudioPlayerCacheDir();
  if (!dir) return null;
  try {
    const handle = await dir.getFileHandle(nodeGraphAudioPlayerCacheName(k));
    const blob = await handle.getFile();
    if (!(blob.size > 0)) return null;
    meta[k].last = Date.now();
    nodeGraphAudioPlayerCacheSaveMeta(meta);
    return new File([blob], meta[k].name || "track", { type: meta[k].type || blob.type || "" });
  } catch (_e) {
    delete meta[k];
    nodeGraphAudioPlayerCacheSaveMeta(meta);
    return null;
  }
}

async function nodeGraphAudioPlayerLibraryEnsureItemLoaded(nodeId, item) {
  if (!item) {
    nodeGraphAudioPlayerLog("FAIL", "decode skipped: no playlist item", { nodeId });
    return null;
  }
  const held = nodeGraphAudioPlayerLibraryFindBufferForItem(item);
  if (held) {
    item.sampleId = held.id;
    nodeGraphAudioPlayerLog("INFO", "decode skipped: already in memory", {
      nodeId,
      sampleId: held.id,
      frames: held.frames,
    });
    return held.id;
  }
  let source = "none";
  let file = nodeGraphAudioPlayerLibraryFindFileForItem(item);
  if (file) {
    source = "store";
  } else if (item.fileKey) {
    // After a refresh the picked File is gone: the cache may still have it.
    file = await nodeGraphAudioPlayerCacheGet(item.fileKey);
    if (file) {
      source = "cache";
    } else {
      // Not cached (too big, or dropped): reopen it from disk through the
      // remembered handle; Chrome asks to allow access once (a click).
      file = await nodeGraphAudioPlayerHandleFile(item.fileKey, { ask: true });
      if (file) source = "handle";
    }
    if (file) nodeGraphAudioPlayerLibraryFiles().set(String(item.fileKey), file);
  }
  const path = String(item.path || "").trim();
  nodeGraphAudioPlayerLog("INFO", "decode source", {
    nodeId,
    name: item.name || "",
    source,
    fileKey: item.fileKey || "",
    path,
    fileName: file?.name || "",
    fileBytes: Math.max(0, Math.round(nodeGraphFiniteNumber(file?.size))),
  });
  if (file && typeof loadNodeGraphSampleForNode === "function") {
    if (source === "store" && item.fileKey) {
      nodeGraphAudioPlayerCachePut(item.fileKey, file).catch(() => {});
      const handle = nodeGraphAudioPlayerFileHandles.get(file);
      if (handle) nodeGraphAudioPlayerHandlePut(item.fileKey, handle).catch(() => {});
    }
    const sample = await nodeGraphAudioPlayerLibraryDecodeWithProgress(nodeId, file, {
      commit: true,
      livePlan: true,
      persist: false,
      record: false,
      sourcePath: path || item.name || "",
      syncDisplay: true,
    });
    return sample?.id || "";
  }
  if (path && typeof nodeGraphAudioPlayerLibraryLooksLikeOsPath === "function"
    && nodeGraphAudioPlayerLibraryLooksLikeOsPath(path)
    && typeof loadNodeGraphSamplePathForNode === "function") {
    nodeGraphAudioPlayerLog("INFO", "decode via OS path", { nodeId, path });
    await loadNodeGraphSamplePathForNode(nodeId, path, {
      commit: true,
      livePlan: true,
      persist: false,
      record: false,
      singleFile: true,
      syncDisplay: true,
    });
    const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
    return node?.sample?.id || "";
  }
  if (Number.isFinite(item.hostIndex) && typeof window.soemdspPlayerHostTrack === "function"
    && typeof loadNodeGraphSampleForNode === "function") {
    // Lazy: ask the host page for this one track. The File is not kept in the
    // library store, and the previous track's PCM is released after binding
    // (ReleaseOrphans), so only the playing track stays in memory.
    nodeGraphAudioPlayerLog("INFO", "decode via host request", { nodeId, index: item.hostIndex });
    const hosted = await window.soemdspPlayerHostTrack(item);
    item.bytes = hosted.size;
    const sample = await nodeGraphAudioPlayerLibraryDecodeWithProgress(nodeId, hosted, {
      commit: true,
      livePlan: true,
      persist: false,
      record: false,
      sourcePath: item.name || hosted.name || "",
      syncDisplay: true,
    });
    return sample?.id || "";
  }
  const url = String(item.url || "").trim();
  if (url && typeof loadNodeGraphSampleForNode === "function") {
    nodeGraphAudioPlayerLog("INFO", "decode via URL", { nodeId, url });
    let res;
    try {
      res = await fetch(url, { mode: "cors" });
    } catch (error) {
      throw new Error(`could not fetch ${item.name || url} (CORS or network)`);
    }
    if (!res.ok) {
      throw new Error(`could not fetch ${item.name || url} (${res.status})`);
    }
    const blob = await nodeGraphAudioPlayerLibraryFetchBlobWithProgress(nodeId, res, NODE_GRAPH_AUDIO_PLAYER_DOWNLOAD_SHARE);
    const fileName = decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() || "") || item.name || "track";
    const fetched = new File([blob], fileName, { type: blob.type || "", lastModified: 0 });
    const key = nodeGraphAudioPlayerLibraryFileKey(fetched);
    nodeGraphAudioPlayerLibraryFiles().set(key, fetched);
    item.fileKey = key;
    item.bytes = fetched.size;
    const downloadedTo = typeof nodeGraphAudioPlayerPlaylistLoadProgress !== "undefined"
      ? nodeGraphAudioPlayerPlaylistLoadProgress.get(String(nodeId || "")) || 0
      : 0;
    const sample = await nodeGraphAudioPlayerLibraryDecodeWithProgress(nodeId, fetched, {
      commit: true,
      livePlan: true,
      persist: false,
      record: false,
      sourcePath: url,
      syncDisplay: true,
    }, downloadedTo);
    return sample?.id || "";
  }
  throw new Error(`no local file for ${item.name || item.path || "track"} — press play to allow access again, or Load File (it opens your last music folder)`);
}

async function nodeGraphAudioPlayerLibraryPlayIndex(nodeId, index, { autoplay = true, transport } = {}) {
  if (typeof nodeGraphAudioPlayerPlaylistBeginLoad === "function") {
    nodeGraphAudioPlayerPlaylistBeginLoad(nodeId);
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    if (typeof nodeGraphAudioPlayerPlaylistEndLoad === "function") {
      nodeGraphAudioPlayerPlaylistEndLoad(nodeId);
    }
    nodeGraphAudioPlayerLog("FAIL", "play ignored: not a Music Player", {
      nodeId,
      type: node?.type || "",
    });
    return;
  }
  const pl = typeof nodeGraphAudioPlayerPlaylistEnsureQueues === "function"
    ? nodeGraphAudioPlayerPlaylistEnsureQueues(nodeGraphAudioPlayerPlaylistForNode(nodeId))
    : nodeGraphAudioPlayerPlaylistForNode(nodeId);
  if (!pl.items.length) {
    if (typeof nodeGraphAudioPlayerPlaylistEndLoad === "function") {
      nodeGraphAudioPlayerPlaylistEndLoad(nodeId);
    }
    nodeGraphAudioPlayerLog("FAIL", "play ignored: playlist empty", { nodeId });
    return;
  }
  const nextIndex = Math.max(0, Math.min(pl.items.length - 1, Math.round(nodeGraphFiniteNumber(index))));
  let item = pl.items[nextIndex];
  if (!item) {
    if (typeof nodeGraphAudioPlayerPlaylistEndLoad === "function") {
      nodeGraphAudioPlayerPlaylistEndLoad(nodeId);
    }
    nodeGraphAudioPlayerLog("FAIL", "play ignored: no item at index", {
      nodeId,
      index: nextIndex,
      items: pl.items.length,
    });
    return;
  }
  if (typeof nodeGraphAudioPlayerPlaylistSetLoadTarget === "function") {
    nodeGraphAudioPlayerPlaylistSetLoadTarget(nodeId, item);
  }
  if (typeof nodeGraphAudioPlayerPlaylistAdoptPlaying === "function") {
    nodeGraphAudioPlayerPlaylistAdoptPlaying(pl, item, { retireCurrent: true });
    item = pl.playing || item;
  }
  if (pl.playNext && typeof nodeGraphAudioPlayerPlaylistItemKey === "function"
    && nodeGraphAudioPlayerPlaylistItemKey(pl.playNext) === nodeGraphAudioPlayerPlaylistItemKey(item)) {
    pl.playNext = null;
  }
  const tokens = nodeGraphAudioPlayerLibraryPlayTokens();
  const token = (nodeGraphFiniteNumber(tokens.get(nodeId))) + 1;
  tokens.set(nodeId, token);
  node.playlist = pl;
  nodeGraphAudioPlayerLog("INFO", "play", {
    nodeId,
    index: nextIndex,
    name: item.name || "",
    fileKey: item.fileKey || "",
    path: item.path || "",
    sampleId: item.sampleId || "",
    hasFile: Boolean(nodeGraphAudioPlayerLibraryFindFileForItem(item)),
  });
  if (!nodeGraphAudioPlayerLibraryItemLoaded(item)) {
    if (typeof setNodeGraphSampleStatus === "function") {
      setNodeGraphSampleStatus(nodeId, `loading ${item.name}...`);
    }
    try {
      const sampleId = await nodeGraphAudioPlayerLibraryEnsureItemLoaded(nodeId, item);
      if (tokens.get(nodeId) !== token) {
        nodeGraphAudioPlayerLog("INFO", "play superseded during decode", { nodeId, token });
        if (typeof nodeGraphAudioPlayerPlaylistEndLoad === "function") {
          nodeGraphAudioPlayerPlaylistEndLoad(nodeId);
        }
        return;
      }
      item.sampleId = sampleId || item.sampleId;
      nodeGraphAudioPlayerLog("INFO", "decoded", {
        nodeId,
        sampleId: item.sampleId || "",
        frames: nodeGraphMvp?.sampleBuffers?.get?.(item.sampleId)?.frames || 0,
        channels: nodeGraphMvp?.sampleBuffers?.get?.(item.sampleId)?.channels || 0,
      });
    } catch (error) {
      if (tokens.get(nodeId) !== token) {
        if (typeof nodeGraphAudioPlayerPlaylistEndLoad === "function") {
          nodeGraphAudioPlayerPlaylistEndLoad(nodeId);
        }
        return;
      }
      const message = String(error?.message || error || "load failed");
      if (typeof setNodeGraphSampleStatus === "function") {
        setNodeGraphSampleStatus(nodeId, message);
      }
      if (typeof setNodeInteractionHelp === "function") {
        setNodeInteractionHelp(message);
      }
      nodeGraphAudioPlayerLog("FAIL", message, {
        name: item.name || "",
        fileKey: item.fileKey || "",
        path: item.path || "",
      });
      if (typeof nodeGraphAudioPlayerPlaylistEndLoad === "function") {
        nodeGraphAudioPlayerPlaylistEndLoad(nodeId);
      }
      return;
    }
  }
  const live = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : node;
  if (!live || tokens.get(nodeId) !== token) {
    nodeGraphAudioPlayerLog("INFO", "play superseded after decode", { nodeId, token });
    if (typeof nodeGraphAudioPlayerPlaylistEndLoad === "function") {
      nodeGraphAudioPlayerPlaylistEndLoad(nodeId);
    }
    return;
  }
  const found = nodeGraphAudioPlayerLibraryFindBufferForItem(item)
    || (live.sample?.id && nodeGraphMvp?.sampleBuffers?.get?.(live.sample.id)
      ? { id: live.sample.id, buf: nodeGraphMvp.sampleBuffers.get(live.sample.id) }
      : null);
  if (found?.id) {
    item.sampleId = found.id;
  } else if (!item.sampleId && live.sample?.id) {
    item.sampleId = String(live.sample.id);
  }
  if (!found && !nodeGraphAudioPlayerLibraryItemLoaded(item) && !nodeGraphMvp?.sampleBuffers?.get?.(item.sampleId || live.sample?.id)) {
    const message = `could not decode ${item.name || "track"}`;
    if (typeof setNodeGraphSampleStatus === "function") {
      setNodeGraphSampleStatus(nodeId, message);
    }
    if (typeof setNodeInteractionHelp === "function") {
      setNodeInteractionHelp(message);
    }
    nodeGraphAudioPlayerLog("FAIL", message, { sampleId: item.sampleId || live.sample?.id || "" });
    if (typeof nodeGraphAudioPlayerPlaylistEndLoad === "function") {
      nodeGraphAudioPlayerPlaylistEndLoad(nodeId);
    }
    return;
  }
  nodeGraphAudioPlayerLibraryReleaseOrphans(nodeId, item.sampleId || found?.id || live.sample?.id);
  const prevId = String(live.sample?.id || "");
  const nextId = String(item.sampleId || found?.id || "");
  live.sample = {
    id: item.sampleId,
    name: item.name || found?.buf?.name || item.sampleId,
    ...(item.fileKey ? { fileKey: item.fileKey } : {}),
    ...(item.path ? { sourcePath: item.path } : {}),
  };
  if (prevId && nextId && prevId !== nextId && typeof nodeGraphAudioPlayerRestartPhaseSet === "function") {
    nodeGraphAudioPlayerRestartPhaseSet(nodeId, 0);
  }
  live.samplePhase = typeof nodeGraphAudioPlayerRestartPhaseGet === "function"
    ? nodeGraphAudioPlayerRestartPhaseGet(nodeId)
    : 0;
  live.samplePhaseSeek = Math.round(nodeGraphFiniteNumber(live.samplePhaseSeek, 0)) + 1;
  if (!live.params || typeof live.params !== "object") {
    live.params = {};
  }
  live.params.playlistScrub = "0";
  if (autoplay && typeof nodeGraphAudioPlayerWriteTransport === "function") {
    if (Number.isFinite(Math.round(Number(transport)))) {
      // Playmode slider: its value is the mode, and it may have moved during the load.
      // Apply what it says now; Stop / Pause chosen meanwhile stay (no write behind the user).
      const now = typeof nodeGraphAudioPlayerTransportBase === "function"
        ? nodeGraphAudioPlayerTransportBase(nodeId)
        : Math.round(Number(transport));
      if (now >= 3) {
        nodeGraphAudioPlayerWriteTransport(nodeId, now);
      }
    } else {
      nodeGraphAudioPlayerWriteTransport(nodeId, nodeGraphAudioPlayerPlaylistPlayModeForLoop(pl.loopMode));
    }
  }
  const est = typeof nodeGraphAudioPlayerPlaylistEstimateBytes === "function"
    ? nodeGraphAudioPlayerPlaylistEstimateBytes(item.sampleId)
    : null;
  if (est?.loaded) {
    item.bytes = est.bytes || item.bytes;
    item.frames = est.frames;
    item.sampleRate = est.sampleRate;
    item.channels = est.channels;
  }
  if (typeof scheduleNodeGraphLivePlanSync === "function") {
    scheduleNodeGraphLivePlanSync("plan");
  }
  if (typeof syncNodeGraphSampleDisplayForNode === "function") {
    syncNodeGraphSampleDisplayForNode(nodeId);
  }
  if (typeof nodeGraphAudioPlayerPlaylistRefreshUi === "function") {
    nodeGraphAudioPlayerPlaylistRefreshUi(nodeId);
  }
  const section = document.querySelector(
    `.node-sample-waveform-display[data-node="${CSS.escape(String(nodeId))}"]`,
  );
  if (section && typeof nodeGraphSampleWaveformEnsureLoop === "function") {
    nodeGraphSampleWaveformEnsureLoop(section);
  }
  if (typeof setNodeInteractionHelp === "function") {
    setNodeInteractionHelp(`playing ${item.name}`);
  }
  const boundId = String(live.sample?.id || item.sampleId || "");
  const boundBuf = boundId ? nodeGraphMvp?.sampleBuffers?.get?.(boundId) : null;
  nodeGraphAudioPlayerLog("INFO", "bound", {
    nodeId,
    sampleId: boundId,
    frames: boundBuf?.frames || 0,
    channels: boundBuf?.channels || 0,
    transport: live.params?.transport || "",
    autoplay,
    displayName: typeof nodeGraphAudioPlayerPlaylistCurrentSampleRef === "function"
      ? (nodeGraphAudioPlayerPlaylistCurrentSampleRef(live)?.name || "")
      : (live.sample?.name || ""),
  });
  if (typeof nodeGraphAudioPlayerPlaylistEndLoad === "function") {
    nodeGraphAudioPlayerPlaylistEndLoad(nodeId);
  }
}

function nodeGraphAudioPlayerLibraryPlayNext(nodeId, options = {}) {
  if (options.fromAuto && typeof nodeGraphAudioPlayerPlaylistAutoAdvanceBlocked === "function"
    && nodeGraphAudioPlayerPlaylistAutoAdvanceBlocked(nodeId)) {
    nodeGraphAudioPlayerLog("INFO", "auto-advance ignored: still loading next track", { nodeId });
    return;
  }
  const pl = typeof nodeGraphAudioPlayerPlaylistEnsureQueues === "function"
    ? nodeGraphAudioPlayerPlaylistEnsureQueues(nodeGraphAudioPlayerPlaylistForNode(nodeId))
    : nodeGraphAudioPlayerPlaylistForNode(nodeId);
  const transport = typeof nodeGraphAudioPlayerTransportBase === "function"
    ? nodeGraphAudioPlayerTransportBase(nodeId)
    : 4;
  const wrap = pl.loopMode === "all" || transport === 5;
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (typeof nodeGraphAudioPlayerPlaylistRetirePlaying === "function") {
    nodeGraphAudioPlayerPlaylistRetirePlaying(pl);
  } else if (pl.removeAfterPlay) {
    pl.playing = null;
  } else if (pl.playing) {
    pl.played = [...(pl.played || []), pl.playing];
    pl.playing = null;
  }
  if (typeof nodeGraphAudioPlayerPlaylistSyncQueues === "function") {
    nodeGraphAudioPlayerPlaylistSyncQueues(pl);
  }
  const keyOf = typeof nodeGraphAudioPlayerPlaylistItemKey === "function"
    ? nodeGraphAudioPlayerPlaylistItemKey
    : (item) => String(item?.path || item?.id || "");
  const queuedKey = keyOf(pl.playNext);
  const queued = queuedKey
    ? (pl.items || []).find((item) => keyOf(item) === queuedKey) || null
    : null;
  const fromKeyEarly = String(options.fromKey || "");
  let fromEarly = fromKeyEarly
    ? (pl.items || []).findIndex((entry) => keyOf(entry) === fromKeyEarly)
    : -1;
  if (fromEarly < 0) {
    fromEarly = Math.max(0, Math.round(nodeGraphFiniteNumber(pl.index)));
  }
  const sequentialNext = (pl.items || []).find((item, i) => i > fromEarly) || null;
  if (!(pl.unplayed || []).length && !queued && !(transport === 4 && sequentialNext)) {
    if (wrap && (pl.played || []).length) {
      pl.played = [];
      if (typeof nodeGraphAudioPlayerPlaylistSyncQueues === "function") {
        nodeGraphAudioPlayerPlaylistSyncQueues(pl);
      }
    } else {
      if (typeof nodeGraphAudioPlayerPlaylistRebuildItems === "function") {
        nodeGraphAudioPlayerPlaylistRebuildItems(pl);
      }
      if (node) {
        node.playlist = pl;
      }
      if (typeof nodeGraphAudioPlayerPlaylistEndLoad === "function") {
        nodeGraphAudioPlayerPlaylistEndLoad(nodeId);
      }
      if (typeof nodeGraphAudioPlayerWriteTransport === "function") {
        nodeGraphAudioPlayerWriteTransport(nodeId, 1);
      }
      if (typeof nodeGraphAudioPlayerPlaylistDebug === "function") {
        nodeGraphAudioPlayerPlaylistDebug(nodeId, "play-next-stop", {
          fromAuto: Boolean(options.fromAuto),
          wrap,
          why: "no unplayed tracks",
        });
      }
      if (typeof nodeGraphAudioPlayerPlaylistRefreshUi === "function") {
        nodeGraphAudioPlayerPlaylistRefreshUi(nodeId);
      }
      if (typeof nodeGraphAudioPlayerPlaylistPersist === "function") {
        nodeGraphAudioPlayerPlaylistPersist(nodeId);
      }
      return;
    }
  }
  let next = null;
  if (queued) {
    next = queued;
    pl.playNext = null;
  }
  const pool = Array.isArray(pl.unplayed) ? pl.unplayed : [];
  if (!next && pl.shuffle && pool.length) {
    next = pool[Math.floor(Math.random() * pool.length)];
  } else if (!next && pool.length) {
    const fromKey = String(options.fromKey || "");
    let from = fromKey
      ? (pl.items || []).findIndex((entry) => keyOf(entry) === fromKey)
      : -1;
    if (from < 0) {
      from = Math.max(0, Math.round(nodeGraphFiniteNumber(pl.index)));
    }
    const after = pool.find((item) => {
      const found = (pl.items || []).findIndex((entry) => keyOf(entry) === keyOf(item));
      return found > from;
    });
    next = after || pool[0];
  }
  if (!next && transport === 4 && sequentialNext) {
    next = sequentialNext;
  }
  pl.playing = next || null;
  if (typeof nodeGraphAudioPlayerPlaylistSyncQueues === "function") {
    nodeGraphAudioPlayerPlaylistSyncQueues(pl);
  } else if (typeof nodeGraphAudioPlayerPlaylistRebuildItems === "function") {
    nodeGraphAudioPlayerPlaylistRebuildItems(pl);
  }
  if (node) {
    node.playlist = pl;
  }
  if (next) {
    if (typeof nodeGraphAudioPlayerPlaylistDebug === "function") {
      nodeGraphAudioPlayerPlaylistDebug(nodeId, "play-next", {
        fromAuto: Boolean(options.fromAuto),
        name: next.name || "",
        queued: Boolean(queued && next === queued),
        wrap,
        index: pl.index,
      });
    }
    nodeGraphAudioPlayerLibraryPlayIndex(nodeId, pl.index, { autoplay: true });
    return;
  }
  if (typeof nodeGraphAudioPlayerPlaylistDebug === "function") {
    nodeGraphAudioPlayerPlaylistDebug(nodeId, "play-next-stop", {
      fromAuto: Boolean(options.fromAuto),
      wrap,
      why: "next pick empty",
    });
  }
  if (typeof nodeGraphAudioPlayerPlaylistEndLoad === "function") {
    nodeGraphAudioPlayerPlaylistEndLoad(nodeId);
  }
  if (typeof nodeGraphAudioPlayerWriteTransport === "function") {
    nodeGraphAudioPlayerWriteTransport(nodeId, 1);
  }
}

function nodeGraphAudioPlayerLibraryPlayPrev(nodeId) {
  const pl = typeof nodeGraphAudioPlayerPlaylistEnsureQueues === "function"
    ? nodeGraphAudioPlayerPlaylistEnsureQueues(nodeGraphAudioPlayerPlaylistForNode(nodeId))
    : nodeGraphAudioPlayerPlaylistForNode(nodeId);
  const transport = typeof nodeGraphAudioPlayerTransportBase === "function"
    ? nodeGraphAudioPlayerTransportBase(nodeId)
    : 4;
  const wrap = pl.loopMode === "all" || transport === 5;
  if (!(pl.played || []).length) {
    if (wrap && (pl.unplayed || []).length) {
      const last = pl.unplayed.pop();
      if (pl.playing) {
        pl.unplayed.unshift(pl.playing);
      }
      pl.playing = last;
    } else {
      return;
    }
  } else {
    if (pl.playing) {
      pl.unplayed = [pl.playing, ...(pl.unplayed || [])];
    }
    pl.playing = pl.played.pop();
  }
  if (typeof nodeGraphAudioPlayerPlaylistSyncQueues === "function") {
    nodeGraphAudioPlayerPlaylistSyncQueues(pl);
  } else if (typeof nodeGraphAudioPlayerPlaylistRebuildItems === "function") {
    nodeGraphAudioPlayerPlaylistRebuildItems(pl);
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (node) {
    node.playlist = pl;
  }
  if (pl.playing) {
    nodeGraphAudioPlayerLibraryPlayIndex(nodeId, pl.index, { autoplay: true });
  }
}

async function nodeGraphAudioPlayerLibraryToggleDive(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || node.type !== "audioPlayer") {
    return;
  }
  const pl = nodeGraphAudioPlayerPlaylistForNode(nodeId);
  pl.folderDive = !pl.folderDive;
  node.playlist = pl;
  if (nodeGraphAudioPlayerLibraryStoredFolderPath(pl.folderPath)) {
    await nodeGraphAudioPlayerLibraryBindFolder(nodeId, pl.folderPath, { dive: pl.folderDive });
    return;
  }
  if (typeof nodeGraphAudioPlayerPlaylistPersist === "function") {
    nodeGraphAudioPlayerPlaylistPersist(nodeId);
  }
  if (typeof nodeGraphAudioPlayerPlaylistSyncTransport === "function") {
    nodeGraphAudioPlayerPlaylistSyncTransport(nodeId);
  }
}

// After a refresh: reload each Music Player's current track from the cache
// (no prompt). Tracks only reachable through a handle wait for a click (play),
// since Chrome needs one to grant access.
const nodeGraphAudioPlayerRestored = new Set();
const nodeGraphAudioPlayerRestoreDone = new Set();
let nodeGraphAudioPlayerRestoreWindowOpen = true;

/** True while a node's track may still come back from the cache after boot. */
function nodeGraphAudioPlayerRestoreBusy(nodeId) {
  return nodeGraphAudioPlayerRestoreWindowOpen && !nodeGraphAudioPlayerRestoreDone.has(String(nodeId || ""));
}
async function nodeGraphAudioPlayerRestoreFromCache() {
  const nodes = (typeof nodeGraphMvp === "object" && nodeGraphMvp?.patch?.nodes) || [];
  for (const node of nodes) {
    if (node?.type !== "audioPlayer" || nodeGraphAudioPlayerRestored.has(node.id)) continue;
    const pl = typeof nodeGraphAudioPlayerPlaylistForNode === "function" ? nodeGraphAudioPlayerPlaylistForNode(node.id) : null;
    const item = pl?.items?.[pl.index || 0];
    if (!item?.fileKey) { nodeGraphAudioPlayerRestoreDone.add(String(node.id)); continue; }
    nodeGraphAudioPlayerRestored.add(node.id);
    if (nodeGraphAudioPlayerLibraryFindBufferForItem(item) || nodeGraphAudioPlayerLibraryFindFileForItem(item)) {
      nodeGraphAudioPlayerRestoreDone.add(String(node.id));
      continue;
    }
    const file = await nodeGraphAudioPlayerCacheGet(item.fileKey);
    if (!file) { nodeGraphAudioPlayerRestoreDone.add(String(node.id)); continue; }
    nodeGraphAudioPlayerLibraryFiles().set(String(item.fileKey), file);
    try {
      const id = await nodeGraphAudioPlayerLibraryEnsureItemLoaded(node.id, item);
      if (id) item.sampleId = id;
      nodeGraphAudioPlayerLog("INFO", "restored from cache after refresh", { nodeId: node.id, name: item.name || "" });
    } catch (error) {
      nodeGraphAudioPlayerLog("INFO", "cache restore failed", { nodeId: node.id, error: String(error?.message || error || "") });
    }
    nodeGraphAudioPlayerRestoreDone.add(String(node.id));
  }
}
if (typeof window !== "undefined") {
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (typeof nodeGraphMvp === "object" && nodeGraphMvp?.patch?.nodes?.length) {
      nodeGraphAudioPlayerRestoreFromCache().catch(() => {});
    }
    if (tries > 30) {
      clearInterval(timer);
      nodeGraphAudioPlayerRestoreWindowOpen = false;
    }
  }, 2000);
}
