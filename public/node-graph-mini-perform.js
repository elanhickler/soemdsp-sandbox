// Mini Performance View (docs/MINI_PERFORM_VIEW_PLAN.md).
// A live, scaled copy of the Performance view inside the workspace.
// Settings are UI preferences kept per machine (localStorage), never in the
// patch. Mini Perform only reads patch.view.canvases. Mini Arrange writes
// tile rects through nodeGraphLayoutCanvasWriteRect. Neither mode touches
// transport or audio. Drawing lives in node-graph-gl-mini-perform.js.

const NODE_GRAPH_MINI_PERFORM_STORAGE_KEY = "soemdsp.miniPerform";

const nodeGraphMiniPerformDefaults = Object.freeze({
  mode: "off",
  anchor: "screen",
  corner: "bottomRight",
  offsetX: 16,
  offsetY: 16,
  worldX: null,
  worldY: null,
  width: 360,
  height: 225,
  aspect: "window",
  opacity: 1,
  refresh: 30,
  frame: true,
});

const nodeGraphMiniPerformChoices = Object.freeze({
  mode: [["off", "Off"], ["perform", "Perform"], ["background", "Background"], ["position", "Position"], ["arrange", "Arrange"]],
  anchor: [["screen", "Screen"], ["workspace", "Workspace"]],
  corner: [["topLeft", "Top left"], ["topRight", "Top right"], ["bottomLeft", "Bottom left"], ["bottomRight", "Bottom right"]],
  aspect: [
    ["free", "Free"],
    ["window", "Window"],
    ["16:9", "16:9"],
    ["4:3", "4:3"],
    ["1:1", "1:1"],
    ["9:16", "9:16"],
    ["phonePortrait", "Phone portrait"],
    ["phoneLandscape", "Phone landscape"],
  ],
  refresh: [["0", "Every frame"], ["30", "30 per second"], ["15", "15 per second"]],
});

const nodeGraphMiniPerformEnlarged = { on: false, box: null };
let nodeGraphMiniPerformDrag = null;

function nodeGraphMiniPerformClamp(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function nodeGraphMiniPerformChoice(key, value, fallback) {
  const list = nodeGraphMiniPerformChoices[key] || [];
  const text = String(value);
  return list.some((entry) => entry[0] === text) ? text : fallback;
}

/** Next mini mode. off → perform → arrange → off. */
function nodeGraphMiniPerformNextMode(mode) {
  const order = nodeGraphMiniPerformChoices.mode.map((entry) => entry[0]);
  const index = order.indexOf(mode);
  return order[(index < 0 ? 0 : index + 1) % order.length];
}

/**
 * Clean a stored or edited settings object. Unknown keys are dropped.
 * fromStorage: a saved "arrange" comes back as "perform" so a fresh session
 * never opens already editing. In-session edits keep Arrange.
 */
function normalizeNodeGraphMiniPerformSettings(raw, options = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const d = nodeGraphMiniPerformDefaults;
  const worldX = Number(src.worldX);
  const worldY = Number(src.worldY);
  let mode = nodeGraphMiniPerformChoice("mode", src.mode, d.mode);
  if (options.fromStorage && (mode === "arrange" || mode === "position" || mode === "background")) mode = "perform";
  return {
    mode,
    anchor: nodeGraphMiniPerformChoice("anchor", src.anchor, d.anchor),
    corner: nodeGraphMiniPerformChoice("corner", src.corner, d.corner),
    offsetX: nodeGraphMiniPerformClamp(src.offsetX, -8000, 8000, d.offsetX),
    offsetY: nodeGraphMiniPerformClamp(src.offsetY, -8000, 8000, d.offsetY),
    worldX: src.worldX == null || !Number.isFinite(worldX) ? null : worldX,
    worldY: src.worldY == null || !Number.isFinite(worldY) ? null : worldY,
    width: Math.round(nodeGraphMiniPerformClamp(src.width, 120, 1600, d.width)),
    height: Math.round(nodeGraphMiniPerformClamp(src.height, 80, 1600, d.height)),
    aspect: nodeGraphMiniPerformChoice("aspect", src.aspect, d.aspect),
    opacity: nodeGraphMiniPerformClamp(src.opacity, 0.1, 1, d.opacity),
    refresh: Number(nodeGraphMiniPerformChoice("refresh", src.refresh, String(d.refresh))),
    frame: src.frame !== false,
  };
}

function nodeGraphMiniPerformSettings() {
  if (!nodeGraphMvp.miniPerform) {
    let stored = null;
    try {
      stored = JSON.parse(window.localStorage?.getItem(NODE_GRAPH_MINI_PERFORM_STORAGE_KEY) || "null");
    } catch (_error) {
      stored = null;
    }
    nodeGraphMvp.miniPerform = normalizeNodeGraphMiniPerformSettings(stored, { fromStorage: true });
  }
  return nodeGraphMvp.miniPerform;
}

function saveNodeGraphMiniPerformSettings() {
  try {
    window.localStorage?.setItem(NODE_GRAPH_MINI_PERFORM_STORAGE_KEY, JSON.stringify(nodeGraphMiniPerformSettings()));
  } catch (_error) {
    // Private mode / quota: the setting still applies for this session.
  }
}

function setNodeGraphMiniPerformSettings(patch = {}, options = {}) {
  const prev = nodeGraphMiniPerformSettings();
  const merged = { ...prev, ...patch };
  if (merged.aspect === "free" && prev.aspect !== "free" && patch.height == null) {
    merged.height = nodeGraphMiniPerformDerivedHeight(prev);
  }
  const next = normalizeNodeGraphMiniPerformSettings(merged);
  const wasShown = nodeGraphMiniPerformShown();
  if (next.anchor === "workspace" && (next.worldX == null || next.worldY == null)) {
    const spot = nodeGraphMiniPerformViewCentreWorld(next);
    next.worldX = spot.x;
    next.worldY = spot.y;
  }
  if (next.mode === "off") nodeGraphMiniPerformExitEnlarged();
  nodeGraphMvp.miniPerform = next;
  if (options.persist !== false) saveNodeGraphMiniPerformSettings();
  if (options.sync !== false) syncNodeGraphMiniPerformPage();
  nodeGraphMiniPerformAfterChange(wasShown);
  return next;
}

/** Perform page, phone canvas and embeds have no circuit builder. */
function nodeGraphMiniPerformPageAllowed() {
  if (typeof document === "undefined") return false;
  if (document.body?.classList.contains("node-perform-mode")) return false;
  if (document.documentElement.classList.contains("node-perform-mode")) return false;
  if (document.documentElement.classList.contains("soemdsp-embed") || document.body?.classList.contains("soemdsp-embed")) return false;
  if (typeof window !== "undefined" && (window.soemdspMobileCanvasMode === true || window.soemdspPerformMode === true)) return false;
  return true;
}

/** True when the mini view should be on screen right now. */
function nodeGraphMiniPerformShown() {
  const mode = nodeGraphMiniPerformSettings().mode;
  if (mode === "off" || !nodeGraphMiniPerformPageAllowed()) return false;
  if (typeof nodeGraphLayoutCanvasMode === "function" && nodeGraphLayoutCanvasMode() !== "off") return false;
  if (document.body?.classList.contains("node-screen-solo-active")) return false;
  const host = document.getElementById("nodeGraphWorkspace");
  return Boolean(host && host.clientWidth > 0 && host.clientHeight > 0);
}

function nodeGraphMiniPerformArrangeShown() {
  return nodeGraphMiniPerformSettings().mode === "arrange" && nodeGraphMiniPerformShown();
}

function nodeGraphMiniPerformHelpForMode(mode) {
  const hidden = typeof nodeGraphLayoutCanvasMode === "function" && nodeGraphLayoutCanvasMode() !== "off";
  if (mode === "off") return "Mini performance view off";
  if (mode === "arrange") {
    return hidden
      ? "Mini performance view: Arrange (shows when the performance view closes)."
      : "Mini performance view: Arrange. Drag tiles to move, tile corners to resize. Shift+F exits arrange.";
  }
  if (mode === "position") {
    return hidden
      ? "Mini performance view: Position (shows when the performance view closes)."
      : "Mini performance view: Position. Drag to move, corners to resize.";
  }
  if (mode === "background") {
    return hidden
      ? "Mini performance view: Background (shows when the performance view closes)."
      : "Mini performance view: Background. Display only.";
  }
  return hidden
    ? "Mini performance view: Perform (shows when the performance view closes)."
    : "Mini performance view: Perform. Drag knobs in the view.";
}

function toggleNodeGraphMiniPerformView() {
  if (!nodeGraphMiniPerformPageAllowed()) return false;
  const next = nodeGraphMiniPerformNextMode(nodeGraphMiniPerformSettings().mode);
  setNodeGraphMiniPerformSettings({ mode: next });
  if (typeof setNodeInteractionHelp === "function") setNodeInteractionHelp(nodeGraphMiniPerformHelpForMode(next));
  return next;
}

function nodeGraphMiniPerformEnlargedActive() {
  return nodeGraphMiniPerformEnlarged.on === true;
}

function nodeGraphMiniPerformEnterEnlarged() {
  if (nodeGraphMiniPerformEnlarged.on) return true;
  nodeGraphMiniPerformEnlarged.on = true;
  nodeGraphMiniPerformEnlarged.box = null;
  return true;
}

/** Exit Enlarged only. Mini mode and the remembered rect stay. */
function nodeGraphMiniPerformExitEnlarged() {
  if (!nodeGraphMiniPerformEnlarged.on) return false;
  nodeGraphMiniPerformEnlarged.on = false;
  nodeGraphMiniPerformEnlarged.box = null;
  if (typeof nodeGraphGlMiniPerformPresent === "function" && nodeGraphMiniPerformShown()) nodeGraphGlMiniPerformPresent();
  return true;
}

function nodeGraphMiniPerformToggleEnlarged() {
  if (nodeGraphMiniPerformEnlarged.on) return !nodeGraphMiniPerformExitEnlarged();
  nodeGraphMiniPerformEnterEnlarged();
  if (typeof setNodeInteractionHelp === "function") setNodeInteractionHelp("Mini performance view enlarged. Escape exits.");
  return true;
}

/** Drop Enlarged and put an in-progress tile back where the drag started. */
function nodeGraphMiniPerformOnPerformanceViewOpening() {
  nodeGraphMiniPerformExitEnlarged();
  nodeGraphMiniPerformCancelTileDrag();
}

function nodeGraphMiniPerformCancelTileDrag() {
  const drag = nodeGraphMiniPerformDrag;
  if (!drag || drag.kind !== "tile") return;
  if (drag.origin && typeof nodeGraphLayoutCanvasWriteRect === "function") {
    nodeGraphLayoutCanvasWriteRect(drag.nodeId, drag.origin, { persist: false });
  }
  drag.view?.removeEventListener("pointermove", drag.move);
  drag.view?.removeEventListener("pointerup", drag.up);
  drag.view?.removeEventListener("pointercancel", drag.up);
  if (drag.view) drag.view._miniDragging = false;
  nodeGraphMiniPerformDrag = null;
}

/** Pinned elements of the current scope. Read-only: never creates buckets. */
function nodeGraphMiniPerformElements(patch = nodeGraphMvp?.patch) {
  const canvases = patch?.view?.canvases;
  if (!canvases || typeof canvases !== "object") return [];
  const scope = typeof nodeGraphLayoutCanvasActiveScopeId === "function" ? nodeGraphLayoutCanvasActiveScopeId() : "";
  const bucket = scope ? canvases.byMetamodule?.[scope] : canvases.root;
  const list = Array.isArray(bucket?.elements) ? bucket.elements : [];
  // A deleted Output / Input keeps its pin (for its respawn) but shows no tile.
  const live = new Set((patch?.nodes || []).map((node) => String(node?.id || "")));
  return list
    .filter((el) => el && el.enabled !== false && live.has(String(el.nodeId || "").trim()))
    .slice()
    .sort((a, b) => (Number(a.z) || 0) - (Number(b.z) || 0));
}

/**
 * One predicate for the viewport cull and scope screen-items: while the mini
 * view is shown, pinned nodes of the current scope count as presented.
 */
function nodeGraphMiniPerformPresentsNode(nodeId) {
  const id = String(nodeId || "").trim();
  if (!id || !nodeGraphMiniPerformShown()) return false;
  const cache = nodeGraphMiniPerformPresentsNode._cache;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (!cache || now - cache.at > 250 || cache.patch !== nodeGraphMvp?.patch) {
    nodeGraphMiniPerformPresentsNode._cache = {
      at: now,
      patch: nodeGraphMvp?.patch,
      ids: new Set(nodeGraphMiniPerformElements().map((el) => String(el.nodeId))),
    };
  }
  return nodeGraphMiniPerformPresentsNode._cache.ids.has(id);
}

/** Host px <-> zoom-1 world px for the workspace camera. */
function nodeGraphMiniPerformCamera() {
  const host = typeof document !== "undefined" ? document.getElementById("nodeGraphWorkspace") : null;
  const zoom = typeof nodeGraphZoom === "function" ? Math.max(0.0001, nodeGraphZoom()) : 1;
  const surface = typeof nodeGraphZoomSurface === "function" ? nodeGraphZoomSurface() : null;
  const sr = surface?.getBoundingClientRect?.();
  const hr = host?.getBoundingClientRect?.();
  const origin = typeof nodeGraphRenderedOriginOffset === "function"
    ? nodeGraphRenderedOriginOffset(nodeGraphMvp?.pan || { x: 0, y: 0 }, host)
    : { x: 0, y: 0 };
  return {
    zoom,
    originX: (sr ? sr.left - (hr?.left || 0) : 0) + (Number(origin.x) || 0),
    originY: (sr ? sr.top - (hr?.top || 0) : 0) + (Number(origin.y) || 0),
  };
}

function nodeGraphMiniPerformDerivedHeight(settings) {
  const width = Math.max(120, Math.min(1600, Number(settings?.width) || 360));
  const aspect = settings?.aspect === "free" ? "window" : settings?.aspect;
  const winW = typeof window !== "undefined" ? window.innerWidth : 1600;
  const winH = typeof window !== "undefined" ? window.innerHeight : 1000;
  const ref = nodeGraphMiniPerformReferenceSize(aspect, winW, winH);
  return Math.round(width * (ref.h / ref.w));
}

function nodeGraphMiniPerformReference(settings = nodeGraphMiniPerformSettings()) {
  return nodeGraphMiniPerformReferenceSize(
    settings.aspect,
    window.innerWidth,
    window.innerHeight,
    settings,
  );
}

function nodeGraphMiniPerformViewCentreWorld(settings) {
  const host = typeof document !== "undefined" ? document.getElementById("nodeGraphWorkspace") : null;
  const cam = nodeGraphMiniPerformCamera();
  const ref = nodeGraphMiniPerformReference(settings);
  const wWorld = Number(settings.width) || 360;
  const hWorld = wWorld * (ref.h / ref.w);
  const cx = ((host?.clientWidth || 0) / 2 - cam.originX) / cam.zoom;
  const cy = ((host?.clientHeight || 0) / 2 - cam.originY) / cam.zoom;
  return { x: Math.round(cx - wWorld / 2), y: Math.round(cy - hWorld / 2) };
}

/** Current frame rect in host px plus scale. Enlarged is a session overlay. */
function nodeGraphMiniPerformFrame() {
  const host = document.getElementById("nodeGraphWorkspace");
  const settings = nodeGraphMiniPerformSettings();
  const ref = nodeGraphMiniPerformReference(settings);
  const hw = host?.clientWidth || 0;
  const hh = host?.clientHeight || 0;
  if (nodeGraphMiniPerformEnlarged.on) {
    const box = nodeGraphMiniPerformEnlarged.box
      || nodeGraphMiniPerformEnlargedRect(hw, hh, ref.w, ref.h);
    return { ...box, ref, s: box.w / Math.max(1, ref.w) };
  }
  const frame = nodeGraphMiniPerformFrameRect(
    settings, ref, hw, hh,
    settings.anchor === "workspace" ? nodeGraphMiniPerformCamera() : null,
  );
  return { ...frame, ref };
}

/** Tile rects in mini-view px (relative to the frame), from the stage. */
function nodeGraphMiniPerformTiles(frame = nodeGraphMiniPerformFrame()) {
  const tiles = [];
  const elements = nodeGraphMiniPerformElements();
  for (let i = 0; i < elements.length; i += 1) {
    const el = elements[i];
    const px = nodeGraphCanvasTileRectPx(el, frame.ref.w, frame.ref.h);
    tiles.push({
      nodeId: String(el.nodeId),
      x: px.x * frame.s,
      y: px.y * frame.s,
      w: px.w * frame.s,
      h: px.h * frame.s,
      refW: px.w,
      refH: px.h,
      z: px.z,
    });
  }
  return tiles;
}

function nodeGraphMiniPerformAfterChange(wasShown) {
  const shown = nodeGraphMiniPerformShown();
  nodeGraphMiniPerformPresentsNode._cache = null;
  if (shown !== wasShown) {
    if (shown && typeof nodeGraphViewportCullWakeNodeById === "function") {
      for (const el of nodeGraphMiniPerformElements()) nodeGraphViewportCullWakeNodeById(el.nodeId);
    }
    if (typeof nodeGraphViewportCullRefresh === "function") nodeGraphViewportCullRefresh();
  }
  if (typeof renderNodeGraphModularViewModeButtons === "function") renderNodeGraphModularViewModeButtons();
  nodeGraphMiniPerformEnsureLoop();
}

function nodeGraphMiniPerformEnsureLoop() {
  if (nodeGraphMiniPerformEnsureLoop._raf) return;
  if (nodeGraphMiniPerformSettings().mode === "off") {
    if (typeof nodeGraphGlMiniPerformHide === "function") nodeGraphGlMiniPerformHide();
    return;
  }
  const tick = (now) => {
    nodeGraphMiniPerformEnsureLoop._raf = 0;
    const settings = nodeGraphMiniPerformSettings();
    if (settings.mode === "off") {
      if (typeof nodeGraphGlMiniPerformHide === "function") nodeGraphGlMiniPerformHide();
      return;
    }
    const shown = nodeGraphMiniPerformShown();
    if (shown !== nodeGraphMiniPerformEnsureLoop._wasShown) {
      nodeGraphMiniPerformEnsureLoop._wasShown = shown;
      nodeGraphMiniPerformPresentsNode._cache = null;
      if (typeof nodeGraphViewportCullRefresh === "function") nodeGraphViewportCullRefresh();
    }
    if (!shown) {
      if (typeof nodeGraphGlMiniPerformHide === "function") nodeGraphGlMiniPerformHide();
    } else {
      const interval = settings.refresh > 0 ? 1000 / settings.refresh : 0;
      const last = nodeGraphMiniPerformEnsureLoop._last || 0;
      if (!interval || now - last >= interval - 2) {
        nodeGraphMiniPerformEnsureLoop._last = now;
        setTimeout(() => {
          if (nodeGraphMiniPerformShown() && typeof nodeGraphGlMiniPerformPresent === "function") nodeGraphGlMiniPerformPresent();
        }, 0);
      }
    }
    nodeGraphMiniPerformEnsureLoop._raf = window.requestAnimationFrame(tick);
  };
  nodeGraphMiniPerformEnsureLoop._raf = window.requestAnimationFrame(tick);
}

// ---- Pointer. The frame always takes the hit. Wheel is left to the workspace. ----

function nodeGraphMiniPerformCornerAt(rect, clientX, clientY) {
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return "";
  const m = 14;
  if (x <= m && y <= m) return "topLeft";
  if (x >= rect.width - m && y <= m) return "topRight";
  if (x <= m && y >= rect.height - m) return "bottomLeft";
  if (x >= rect.width - m && y >= rect.height - m) return "bottomRight";
  return "";
}

function nodeGraphMiniPerformTileHit(clientX, clientY) {
  const view = document.getElementById("nodeMiniPerformView");
  const rect = view?.getBoundingClientRect?.();
  if (!rect) return null;
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const frame = nodeGraphMiniPerformFrame();
  const grip = Math.max(8, 12 * frame.s);
  const tiles = view._miniTiles || [];
  for (let i = tiles.length - 1; i >= 0; i -= 1) {
    const tile = tiles[i];
    if (x < tile.x || y < tile.y || x > tile.x + tile.w || y > tile.y + tile.h) continue;
    let corner = "";
    if (nodeGraphMiniPerformSettings().mode === "arrange") {
      const left = x - tile.x <= grip;
      const right = tile.x + tile.w - x <= grip;
      const top = y - tile.y <= grip;
      const bottom = tile.y + tile.h - y <= grip;
      if (left && top) corner = "nw";
      else if (right && top) corner = "ne";
      else if (left && bottom) corner = "sw";
      else if (right && bottom) corner = "se";
    }
    return { tile, corner };
  }
  return null;
}

/** Select the module and pan the camera so it sits in the middle of the view. */
function nodeGraphMiniPerformFocusNode(nodeId) {
  const id = String(nodeId || "");
  const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(id) : null;
  if (!el) return;
  if (typeof setNodeGraphNodeSelection === "function") setNodeGraphNodeSelection([id]);
  const box = typeof nodeGraphModuleLayoutBox === "function" ? nodeGraphModuleLayoutBox(el) : null;
  const host = document.getElementById("nodeGraphWorkspace");
  if (!box || !host || typeof setNodeGraphPan !== "function") return;
  const cam = nodeGraphMiniPerformCamera();
  const sx = cam.originX + (box.x + box.w / 2) * cam.zoom;
  const sy = cam.originY + (box.y + box.h / 2) * cam.zoom;
  const pan = nodeGraphMvp.pan || { x: 0, y: 0 };
  setNodeGraphPan(pan.x + host.clientWidth / 2 - sx, pan.y + host.clientHeight / 2 - sy);
}

function nodeGraphMiniPerformHostRect() {
  const host = document.getElementById("nodeGraphWorkspace");
  const hostRect = host.getBoundingClientRect();
  const view = document.getElementById("nodeMiniPerformView");
  const rect = view.getBoundingClientRect();
  return {
    host,
    hostRect,
    x: rect.left - hostRect.left,
    y: rect.top - hostRect.top,
    w: rect.width,
    h: rect.height,
  };
}

function nodeGraphMiniPerformApplyHostRect(rect, options = {}) {
  if (nodeGraphMiniPerformEnlarged.on) {
    nodeGraphMiniPerformEnlarged.box = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    return;
  }
  const settings = nodeGraphMiniPerformSettings();
  const zoom = settings.anchor === "workspace" ? nodeGraphMiniPerformCamera().zoom : 1;
  const width = Math.round(nodeGraphMiniPerformClamp(rect.w / zoom, 120, 1600, settings.width));
  const height = Math.round(nodeGraphMiniPerformClamp(rect.h / zoom, 80, 1600, settings.height));
  if (settings.anchor === "workspace") {
    const cam = nodeGraphMiniPerformCamera();
    setNodeGraphMiniPerformSettings({
      width,
      height,
      worldX: (rect.x - cam.originX) / zoom,
      worldY: (rect.y - cam.originY) / zoom,
    }, options);
    return;
  }
  const host = document.getElementById("nodeGraphWorkspace");
  const placed = nodeGraphMiniPerformCornerFromRect(
    rect.x, rect.y, rect.w, rect.h, host?.clientWidth || rect.w, host?.clientHeight || rect.h,
  );
  setNodeGraphMiniPerformSettings({ width, height, ...placed }, options);
}

function nodeGraphMiniPerformResizeHostRect(start, dx, dy, corner) {
  const settings = nodeGraphMiniPerformSettings();
  const enlarged = nodeGraphMiniPerformEnlarged.on;
  const zoom = !enlarged && settings.anchor === "workspace" ? nodeGraphMiniPerformCamera().zoom : 1;
  const host = document.getElementById("nodeGraphWorkspace");
  const free = settings.aspect === "free";
  let w;
  let h;
  if (free) {
    const minW = enlarged ? 1 : 120 * zoom;
    const minH = enlarged ? 1 : 80 * zoom;
    const maxW = enlarged ? 1e9 : 1600 * zoom;
    const maxH = enlarged ? 1e9 : 1600 * zoom;
    const next = nodeGraphMiniPerformResizeFreeRect(
      start.x, start.y, start.w, start.h, dx, dy, corner, minW, minH, maxW, maxH,
    );
    w = next.w;
    h = next.h;
  } else {
    const ref = nodeGraphMiniPerformReference(settings);
    const delta = nodeGraphMiniPerformResizeDelta(dx / zoom, dy / zoom, corner, ref.w, ref.h);
    let stored = (start.w / zoom) + delta;
    if (!enlarged) stored = nodeGraphMiniPerformClamp(stored, 120, 1600, start.w / zoom);
    w = Math.max(1, stored * zoom);
    h = w * (ref.h / ref.w);
  }
  const hw = host?.clientWidth || w;
  const hh = host?.clientHeight || h;
  if (enlarged || settings.anchor !== "workspace") {
    if (free) {
      if (w > hw) w = hw;
      if (h > hh) h = hh;
    } else {
      const ref = nodeGraphMiniPerformReference(settings);
      if (w > hw) {
        w = hw;
        h = w * (ref.h / ref.w);
      }
      if (h > hh) {
        h = hh;
        w = h * (ref.w / ref.h);
      }
    }
  }
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  let x = corner.endsWith("Left") ? right - w : start.x;
  let y = corner.startsWith("top") ? bottom - h : start.y;
  if (enlarged || settings.anchor !== "workspace") {
    x = Math.max(0, Math.min(hw - w, x));
    y = Math.max(0, Math.min(hh - h, y));
  }
  return { x, y, w, h };
}

function nodeGraphMiniPerformMoveHostRect(start, dx, dy) {
  const settings = nodeGraphMiniPerformSettings();
  let x = start.x + dx;
  let y = start.y + dy;
  if (nodeGraphMiniPerformEnlarged.on || settings.anchor !== "workspace") {
    const host = document.getElementById("nodeGraphWorkspace");
    const hw = host?.clientWidth || start.w;
    const hh = host?.clientHeight || start.h;
    x = Math.max(0, Math.min(hw - start.w, x));
    y = Math.max(0, Math.min(hh - start.h, y));
  }
  return { x, y, w: start.w, h: start.h };
}

function nodeGraphMiniPerformTileRectFromDrag(drag, dx, dy) {
  const frame = nodeGraphMiniPerformFrame();
  const settings = nodeGraphMiniPerformSettings();
  const zoom = !nodeGraphMiniPerformEnlarged.on && settings.anchor === "workspace"
    ? nodeGraphMiniPerformCamera().zoom
    : 1;
  const scale = frame.s / zoom;
  const step = nodeGraphMiniPerformDragFraction(dx, dy, frame.ref.w, frame.ref.h, scale, zoom);
  let { x, y, w, h, z } = drag.origin;
  if (drag.tileKind === "move") {
    x += step.x;
    y += step.y;
  } else {
    const c = drag.tileCorner;
    if (c.includes("e")) w += step.x;
    if (c.includes("s")) h += step.y;
    if (c.includes("w")) {
      x += step.x;
      w -= step.x;
    }
    if (c.includes("n")) {
      y += step.y;
      h -= step.y;
    }
  }
  return typeof nodeGraphLayoutCanvasNormalizeRect === "function"
    ? nodeGraphLayoutCanvasNormalizeRect({ x, y, w, h, z }, z)
    : { x, y, w, h, z };
}

function nodeGraphMiniPerformReleaseClick(event) {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const last = nodeGraphMiniPerformReleaseClick._last || 0;
  nodeGraphMiniPerformReleaseClick._last = now;
  const double = now - last < 320;
  if (double) nodeGraphMiniPerformReleaseClick._last = 0;
  const arrange = nodeGraphMiniPerformSettings().mode === "arrange";
  const hit = nodeGraphMiniPerformTileHit(event.clientX, event.clientY);
  if (hit?.tile) {
    if (typeof setNodeGraphNodeSelection === "function") setNodeGraphNodeSelection([hit.tile.nodeId]);
    if (double && !arrange && typeof nodeGraphLayoutCanvasMode === "function" && nodeGraphLayoutCanvasMode() === "off"
      && typeof toggleNodeGraphLayoutCanvasView === "function") {
      toggleNodeGraphLayoutCanvasView();
    }
    return;
  }
  if (double) nodeGraphMiniPerformToggleEnlarged();
}

const NODE_GRAPH_MINI_PERFORM_CONTROL_SEL = ".node-knob-face, .node-slider-readout, .node-plugin-slider-face";

/** Module-layout point under a mini-view pixel, from the maps the GL pass stores. */
function nodeGraphMiniPerformLayoutAt(clientX, clientY) {
  const view = document.getElementById("nodeMiniPerformView");
  const rect = view?.getBoundingClientRect?.();
  const maps = view?._miniMaps;
  if (!rect || !maps?.length) return null;
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  for (let i = maps.length - 1; i >= 0; i -= 1) {
    const map = maps[i];
    if (!(map.scale > 0) || x < map.x || y < map.y || x > map.x + map.w || y > map.y + map.h) continue;
    return {
      nodeId: map.nodeId,
      x: map.layoutX + (x - map.x) / map.scale,
      y: map.layoutY + (y - map.y) / (map.scaleY || map.scale),
    };
  }
  return null;
}

/** Knob or slider drawn in the mini picture. */
function nodeGraphMiniPerformControlAt(clientX, clientY) {
  const at = nodeGraphMiniPerformLayoutAt(clientX, clientY);
  if (!at || typeof nodeGraphNodeElement !== "function" || typeof nodeGraphModuleLayoutBox !== "function") return null;
  const moduleEl = nodeGraphNodeElement(at.nodeId);
  if (!moduleEl) return null;
  const nodes = moduleEl.querySelectorAll(NODE_GRAPH_MINI_PERFORM_CONTROL_SEL);
  let best = null;
  let bestArea = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.closest("[hidden]")) continue;
    const box = nodeGraphModuleLayoutBox(node, moduleEl);
    if (!box || at.x < box.x || at.y < box.y || at.x > box.x + box.w || at.y > box.y + box.h) continue;
    const area = box.w * box.h;
    if (area < bestArea) {
      best = node;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Start the real knob/slider drag from a press on its picture.
 * The hit test needs a point on the live control. The drag then tracks the
 * real pointer, so the value follows the hand in the mini view.
 */
function nodeGraphMiniPerformForwardControl(event, surface) {
  const rect = surface.getBoundingClientRect?.();
  if (!rect || !(rect.width > 0) || !(rect.height > 0) || typeof beginNodeSliderDrag !== "function") return false;
  const fakeX = rect.left + rect.width / 2;
  const fakeY = rect.top + rect.height / 2;
  const forwarded = new Proxy(event, {
    get(source, key) {
      if (key === "target" || key === "currentTarget") return surface;
      if (key === "clientX") return fakeX;
      if (key === "clientY") return fakeY;
      const value = source[key];
      return typeof value === "function" ? value.bind(source) : value;
    },
  });
  beginNodeSliderDrag(forwarded);
  const drag = nodeGraphMvp?.sliderDragging;
  if (drag && drag.surface === surface) {
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    return true;
  }
  return nodeGraphMvp?.sliderLastPointerDown?.surface === surface;
}

function beginNodeGraphMiniPerformPointer(event) {
  const view = document.getElementById("nodeMiniPerformView");
  if (!view || event.button !== 0 || view.hidden) return;
  const mode = nodeGraphMiniPerformSettings().mode;
  if (mode === "background") return;
  const positioning = mode === "position";
  const arrange = mode === "arrange";
  if (mode === "perform") {
    const control = nodeGraphMiniPerformControlAt(event.clientX, event.clientY);
    if (control && nodeGraphMiniPerformForwardControl(event, control)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }
  if (!positioning && !arrange && mode !== "perform") return;
  event.preventDefault();
  event.stopPropagation();
  const placed = nodeGraphMiniPerformHostRect();
  const corner = positioning ? nodeGraphMiniPerformCornerAt(view.getBoundingClientRect(), event.clientX, event.clientY) : "";
  const hit = corner ? null : nodeGraphMiniPerformTileHit(event.clientX, event.clientY);
  const tileDrag = Boolean(arrange && hit?.tile);
  let origin = null;
  if (tileDrag && typeof nodeGraphLayoutCanvasElementForNode === "function") {
    const el = nodeGraphLayoutCanvasElementForNode(hit.tile.nodeId);
    origin = typeof nodeGraphLayoutCanvasNormalizeRect === "function"
      ? nodeGraphLayoutCanvasNormalizeRect(el, el?.z || 0)
      : { x: el?.x || 0, y: el?.y || 0, w: el?.w || 0.36, h: el?.h || 0.32, z: el?.z || 0 };
  }
  const drag = {
    id: event.pointerId,
    x0: event.clientX,
    y0: event.clientY,
    start: { x: placed.x, y: placed.y, w: placed.w, h: placed.h },
    corner,
    kind: tileDrag ? "tile" : (positioning ? (corner ? "resize" : "move") : "click"),
    tileKind: hit?.corner ? "resize" : "move",
    tileCorner: hit?.corner || "",
    nodeId: hit?.tile?.nodeId || "",
    origin,
    view,
    moved: false,
  };
  const move = (e) => {
    if (!nodeGraphMiniPerformDrag || e.pointerId !== drag.id) return;
    if (drag.kind === "click") return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    view._miniDragging = true;
    if (drag.kind === "tile") {
      const rect = nodeGraphMiniPerformTileRectFromDrag(drag, dx, dy);
      if (typeof nodeGraphLayoutCanvasWriteRect === "function") {
        nodeGraphLayoutCanvasWriteRect(drag.nodeId, rect, { persist: false });
      }
      return;
    }
    const next = drag.corner
      ? nodeGraphMiniPerformResizeHostRect(drag.start, dx, dy, drag.corner)
      : nodeGraphMiniPerformMoveHostRect(drag.start, dx, dy);
    nodeGraphMiniPerformApplyHostRect(next, { persist: false });
  };
  const up = (e) => {
    if (!nodeGraphMiniPerformDrag || e.pointerId !== drag.id) return;
    view.removeEventListener("pointermove", move);
    view.removeEventListener("pointerup", up);
    view.removeEventListener("pointercancel", up);
    view._miniDragging = false;
    nodeGraphMiniPerformDrag = null;
    if (!drag.moved) {
      nodeGraphMiniPerformReleaseClick(e);
      return;
    }
    if (drag.kind === "tile") {
      const rect = nodeGraphMiniPerformTileRectFromDrag(drag, e.clientX - drag.x0, e.clientY - drag.y0);
      if (typeof nodeGraphLayoutCanvasWriteRect === "function") nodeGraphLayoutCanvasWriteRect(drag.nodeId, rect);
      return;
    }
    if (drag.kind === "click") return;
    saveNodeGraphMiniPerformSettings();
  };
  drag.move = move;
  drag.up = up;
  nodeGraphMiniPerformDrag = drag;
  try { view.setPointerCapture(event.pointerId); } catch (_error) { /* not active */ }
  view.addEventListener("pointermove", move);
  view.addEventListener("pointerup", up);
  view.addEventListener("pointercancel", up);
}

function nodeGraphMiniPerformResetPlacement() {
  const settings = nodeGraphMiniPerformSettings();
  const d = nodeGraphMiniPerformDefaults;
  nodeGraphMiniPerformExitEnlarged();
  if (settings.anchor === "workspace") {
    const spot = nodeGraphMiniPerformViewCentreWorld({ ...settings, width: d.width, height: d.height });
    setNodeGraphMiniPerformSettings({ width: d.width, height: d.height, worldX: spot.x, worldY: spot.y });
    return;
  }
  setNodeGraphMiniPerformSettings({
    width: d.width,
    height: d.height,
    corner: "bottomRight",
    offsetX: 16,
    offsetY: 16,
  });
}

// ---- Command Center page ----

function applyNodeGraphMiniPerformPageSize(size = {}, panelArg = null) {
  const panel = panelArg || document.getElementById("nodeMiniPerformPage");
  if (!panel) return null;
  if (typeof applyNodeGraphUnifiedWindowShellSize === "function") {
    return applyNodeGraphUnifiedWindowShellSize(panel, size);
  }
  return null;
}

function setNodeGraphMiniPerformPageOpen(open) {
  const panel = document.getElementById("nodeMiniPerformPage");
  if (!panel) return;
  const switching = Boolean(nodeGraphMvp?._unifiedWindowSwitching);
  if (open && !switching && typeof openNodeGraphUnifiedWindowPage === "function") {
    openNodeGraphUnifiedWindowPage("miniPerform");
    return;
  }
  panel.hidden = !open;
  if (open) {
    panel.classList.add("node-unified-window");
    if (typeof markNodeGraphFloatingWindowSurface === "function") markNodeGraphFloatingWindowSurface(panel);
    if (typeof noteNodeGraphUnifiedWindowOpened === "function") noteNodeGraphUnifiedWindowOpened("miniPerform", panel);
    renderNodeGraphMiniPerformPage();
  }
}

function nodeGraphMiniPerformRow(label, control) {
  const row = document.createElement("label");
  row.className = "node-mini-perform-row";
  const text = document.createElement("span");
  text.textContent = label;
  row.append(text, control);
  return row;
}

function nodeGraphMiniPerformSelect(key) {
  const select = document.createElement("select");
  select.dataset.miniPerformKey = key;
  for (const [value, label] of nodeGraphMiniPerformChoices[key]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  return select;
}

function nodeGraphMiniPerformInput(key, type, attrs = {}) {
  const input = document.createElement("input");
  input.type = type;
  input.dataset.miniPerformKey = key;
  for (const [name, value] of Object.entries(attrs)) input.setAttribute(name, String(value));
  return input;
}

function nodeGraphMiniPerformButtonRow(label, key) {
  const row = document.createElement("div");
  row.className = "node-mini-perform-row node-mini-perform-row-stack";
  const text = document.createElement("span");
  text.textContent = label;
  const group = document.createElement("div");
  group.className = "node-mini-perform-choices";
  for (const [value, name] of nodeGraphMiniPerformChoices[key]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.miniPerformKey = key;
    button.dataset.miniPerformValue = value;
    button.textContent = name;
    group.append(button);
  }
  row.append(text, group);
  return row;
}

function renderNodeGraphMiniPerformPage() {
  const body = document.getElementById("nodeMiniPerformPageBody");
  if (!body) return;
  if (body.dataset.miniPerformReady !== "true") {
    body.dataset.miniPerformReady = "true";
    const note = document.createElement("p");
    note.id = "nodeMiniPerformNote";
    note.className = "node-mini-perform-note";
    note.textContent = "Only in the circuit builder.";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.dataset.miniPerformKey = "reset";
    reset.textContent = "Reset position and size";
    const rows = [
      nodeGraphMiniPerformButtonRow("Mini view mode (Shift+F)", "mode"),
      nodeGraphMiniPerformRow("Anchor", nodeGraphMiniPerformSelect("anchor")),
      nodeGraphMiniPerformButtonRow("Aspect ratio", "aspect"),
      nodeGraphMiniPerformRow("Opacity", nodeGraphMiniPerformInput("opacity", "range", { min: 0.1, max: 1, step: 0.05 })),
      nodeGraphMiniPerformRow("Refresh rate", nodeGraphMiniPerformSelect("refresh")),
      nodeGraphMiniPerformRow("Show frame", nodeGraphMiniPerformInput("frame", "checkbox")),
      nodeGraphMiniPerformRow("Placement", reset),
    ];
    body.replaceChildren(note, ...rows);
    body.addEventListener("change", handleNodeGraphMiniPerformControl);
    body.addEventListener("input", handleNodeGraphMiniPerformControl);
    body.addEventListener("click", handleNodeGraphMiniPerformControl);
  }
  syncNodeGraphMiniPerformPage();
}

function handleNodeGraphMiniPerformControl(event) {
  const control = event.target;
  const key = control?.dataset?.miniPerformKey;
  if (!key) return;
  if (key === "reset") {
    if (event.type !== "click") return;
    nodeGraphMiniPerformResetPlacement();
    return;
  }
  if (control.dataset.miniPerformValue) {
    if (event.type !== "click") return;
    setNodeGraphMiniPerformSettings({ [key]: control.dataset.miniPerformValue });
    return;
  }
  if (event.type === "click") return;
  if (event.type === "input" && control.type === "number") return;
  let value;
  if (control.type === "checkbox") value = control.checked;
  else if (control.type === "number" || control.type === "range") value = Number(control.value);
  else value = control.value;
  const patch = { [key]: value };
  if (key === "anchor" && value === "workspace") {
    patch.worldX = null;
    patch.worldY = null;
  }
  setNodeGraphMiniPerformSettings(patch);
}

function syncNodeGraphMiniPerformPage() {
  const body = document.getElementById("nodeMiniPerformPageBody");
  if (!body || body.dataset.miniPerformReady !== "true") return;
  const settings = nodeGraphMiniPerformSettings();
  const allowed = nodeGraphMiniPerformPageAllowed();
  const note = document.getElementById("nodeMiniPerformNote");
  if (note) note.hidden = allowed;
  for (const control of body.querySelectorAll("[data-mini-perform-key]")) {
    const key = control.dataset.miniPerformKey;
    control.disabled = !allowed && key !== "reset";
    if (control.dataset.miniPerformValue) {
      control.setAttribute("aria-pressed", String(settings[key] === control.dataset.miniPerformValue));
      continue;
    }
    if (document.activeElement === control && control.type === "number") continue;
    if (control.type === "checkbox") control.checked = Boolean(settings[key]);
    else if (control.tagName === "SELECT" || control.type === "range" || control.type === "number") {
      control.value = String(settings[key]);
    }
  }
}

function bindNodeGraphMiniPerformPageEvents() {
  if (document.documentElement.dataset.miniPerformPageBound === "true") return;
  document.documentElement.dataset.miniPerformPageBound = "true";
  document.getElementById("nodeMiniPerformPageClose")?.addEventListener("click", () => {
    if (typeof closeNodeGraphUnifiedWindowPage === "function") {
      closeNodeGraphUnifiedWindowPage("miniPerform");
      return;
    }
    setNodeGraphMiniPerformPageOpen(false);
  });
  document.querySelector("#nodeMiniPerformPage .scene-context-heading")?.addEventListener("pointerdown", (event) => {
    if (typeof beginNodeGraphRegisteredFloatingWindowDrag === "function") {
      beginNodeGraphRegisteredFloatingWindowDrag(event, "miniPerform");
    }
  });
  document.getElementById("nodeMiniPerformPageResizeHandle")?.addEventListener("pointerdown", (event) => {
    if (typeof beginNodeGraphRegisteredFloatingWindowResize === "function") {
      beginNodeGraphRegisteredFloatingWindowResize(event, "miniPerform");
    }
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== NODE_GRAPH_MINI_PERFORM_STORAGE_KEY) return;
    const was = nodeGraphMiniPerformShown();
    nodeGraphMvp.miniPerform = null;
    nodeGraphMiniPerformSettings();
    syncNodeGraphMiniPerformPage();
    nodeGraphMiniPerformAfterChange(was);
  });
  if (typeof renderNodeGraphModularViewModeButtons === "function") renderNodeGraphModularViewModeButtons();
  nodeGraphMiniPerformEnsureLoop();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindNodeGraphMiniPerformPageEvents, { once: true });
  } else {
    bindNodeGraphMiniPerformPageEvents();
  }
}
