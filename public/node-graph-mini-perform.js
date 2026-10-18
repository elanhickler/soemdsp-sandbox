// Mini Performance View (docs/MINI_PERFORM_VIEW_PLAN.md).
// A live, scaled copy of the F performance screen inside the workspace.
// Settings are UI preferences kept per machine (localStorage), never in the
// patch. The view only reads patch.view.canvases; it never pins, never writes
// the layout and never touches transport or audio. Drawing lives in
// node-graph-gl-mini-perform.js (WebGL2, shared context).

const NODE_GRAPH_MINI_PERFORM_STORAGE_KEY = "soemdsp.miniPerform";

const nodeGraphMiniPerformDefaults = Object.freeze({
  show: false,
  anchor: "screen",
  corner: "bottomRight",
  margin: 16,
  worldX: null,
  worldY: null,
  width: 360,
  reference: "window",
  opacity: 1,
  pointer: "clickThrough",
  refresh: 30,
  frame: true,
});

const nodeGraphMiniPerformChoices = Object.freeze({
  anchor: [["screen", "Screen"], ["workspace", "Workspace"]],
  corner: [["topLeft", "Top left"], ["topRight", "Top right"], ["bottomLeft", "Bottom left"], ["bottomRight", "Bottom right"]],
  reference: [["window", "Window"], ["phonePortrait", "Phone portrait (9:19.5)"], ["phoneLandscape", "Phone landscape (19.5:9)"]],
  pointer: [["clickThrough", "Click-through"], ["interactive", "Interactive"]],
  refresh: [["0", "Every frame"], ["30", "30 per second"], ["15", "15 per second"]],
});

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

/** Clean a stored or edited settings object. Unknown keys are dropped. */
function normalizeNodeGraphMiniPerformSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const d = nodeGraphMiniPerformDefaults;
  const worldX = Number(src.worldX);
  const worldY = Number(src.worldY);
  return {
    show: src.show === true,
    anchor: nodeGraphMiniPerformChoice("anchor", src.anchor, d.anchor),
    corner: nodeGraphMiniPerformChoice("corner", src.corner, d.corner),
    margin: Math.round(nodeGraphMiniPerformClamp(src.margin, 0, 200, d.margin)),
    worldX: src.worldX == null || !Number.isFinite(worldX) ? null : worldX,
    worldY: src.worldY == null || !Number.isFinite(worldY) ? null : worldY,
    width: Math.round(nodeGraphMiniPerformClamp(src.width, 120, 1600, d.width)),
    reference: nodeGraphMiniPerformChoice("reference", src.reference, d.reference),
    opacity: nodeGraphMiniPerformClamp(src.opacity, 0.1, 1, d.opacity),
    pointer: nodeGraphMiniPerformChoice("pointer", src.pointer, d.pointer),
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
    nodeGraphMvp.miniPerform = normalizeNodeGraphMiniPerformSettings(stored);
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
  const next = normalizeNodeGraphMiniPerformSettings({ ...nodeGraphMiniPerformSettings(), ...patch });
  const wasShown = nodeGraphMiniPerformShown();
  // Switching to Workspace with no stored spot: centre of the current view.
  if (next.anchor === "workspace" && (next.worldX == null || next.worldY == null)) {
    const spot = nodeGraphMiniPerformViewCentreWorld(next);
    next.worldX = spot.x;
    next.worldY = spot.y;
  }
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
  if (!nodeGraphMiniPerformSettings().show || !nodeGraphMiniPerformPageAllowed()) return false;
  if (typeof nodeGraphLayoutCanvasMode === "function" && nodeGraphLayoutCanvasMode() !== "off") return false;
  if (document.body?.classList.contains("node-screen-solo-active")) return false;
  const host = document.getElementById("nodeGraphWorkspace");
  return Boolean(host && host.clientWidth > 0 && host.clientHeight > 0);
}

function toggleNodeGraphMiniPerformView() {
  if (!nodeGraphMiniPerformPageAllowed()) return false;
  const next = !nodeGraphMiniPerformSettings().show;
  setNodeGraphMiniPerformSettings({ show: next });
  if (typeof setNodeInteractionHelp === "function") {
    setNodeInteractionHelp(next ? "Mini performance view on" : "Mini performance view off");
  }
  return next;
}

/** Pinned elements of the current scope. Read-only: never creates buckets. */
function nodeGraphMiniPerformElements(patch = nodeGraphMvp?.patch) {
  const canvases = patch?.view?.canvases;
  if (!canvases || typeof canvases !== "object") return [];
  const scope = typeof nodeGraphLayoutCanvasActiveScopeId === "function" ? nodeGraphLayoutCanvasActiveScopeId() : "";
  const bucket = scope ? canvases.byMetamodule?.[scope] : canvases.root;
  const list = Array.isArray(bucket?.elements) ? bucket.elements : [];
  return list
    .filter((el) => el && el.enabled !== false && String(el.nodeId || "").trim())
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
  const host = document.getElementById("nodeGraphWorkspace");
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

function nodeGraphMiniPerformReference(settings = nodeGraphMiniPerformSettings()) {
  return nodeGraphMiniPerformReferenceSize(settings.reference, window.innerWidth, window.innerHeight);
}

function nodeGraphMiniPerformViewCentreWorld(settings) {
  const host = document.getElementById("nodeGraphWorkspace");
  const cam = nodeGraphMiniPerformCamera();
  const ref = nodeGraphMiniPerformReference(settings);
  const wWorld = Number(settings.width) || 360;
  const hWorld = wWorld * (ref.h / ref.w);
  const cx = ((host?.clientWidth || 0) / 2 - cam.originX) / cam.zoom;
  const cy = ((host?.clientHeight || 0) / 2 - cam.originY) / cam.zoom;
  return { x: Math.round(cx - wWorld / 2), y: Math.round(cy - hWorld / 2) };
}

/** Current frame rect in host px plus scale. */
function nodeGraphMiniPerformFrame() {
  const host = document.getElementById("nodeGraphWorkspace");
  const settings = nodeGraphMiniPerformSettings();
  const ref = nodeGraphMiniPerformReference(settings);
  const frame = nodeGraphMiniPerformFrameRect(
    settings, ref, host?.clientWidth || 0, host?.clientHeight || 0,
    settings.anchor === "workspace" ? nodeGraphMiniPerformCamera() : null,
  );
  return { ...frame, ref };
}

/** Tile rects in mini-view px (relative to the frame), from the reference stage. */
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
    // Pinned modules wake (or sleep again) under the viewport cull.
    if (shown && typeof nodeGraphViewportCullWakeNodeById === "function") {
      for (const el of nodeGraphMiniPerformElements()) nodeGraphViewportCullWakeNodeById(el.nodeId);
    }
    if (typeof nodeGraphViewportCullRefresh === "function") nodeGraphViewportCullRefresh();
  }
  nodeGraphMiniPerformEnsureLoop();
}

// ---- Loop: one rAF while the setting is on. Draws at the refresh rate. ----

function nodeGraphMiniPerformEnsureLoop() {
  if (nodeGraphMiniPerformEnsureLoop._raf) return;
  if (!nodeGraphMiniPerformSettings().show) {
    if (typeof nodeGraphGlMiniPerformHide === "function") nodeGraphGlMiniPerformHide();
    return;
  }
  const tick = (now) => {
    nodeGraphMiniPerformEnsureLoop._raf = 0;
    const settings = nodeGraphMiniPerformSettings();
    if (!settings.show) {
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
        // After this frame's other rAF work: face painters fill their canvases
        // inside rAF, so presenting from a task reads finished pictures.
        setTimeout(() => {
          if (nodeGraphMiniPerformShown() && typeof nodeGraphGlMiniPerformPresent === "function") nodeGraphGlMiniPerformPresent();
        }, 0);
      }
    }
    nodeGraphMiniPerformEnsureLoop._raf = window.requestAnimationFrame(tick);
  };
  nodeGraphMiniPerformEnsureLoop._raf = window.requestAnimationFrame(tick);
}

// ---- Pointer (Interactive). Click-through leaves pointer-events off. ----

function nodeGraphMiniPerformTileAt(clientX, clientY) {
  const view = document.getElementById("nodeMiniPerformView");
  const rect = view?.getBoundingClientRect?.();
  if (!rect) return null;
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const tiles = view._miniTiles || [];
  for (let i = tiles.length - 1; i >= 0; i -= 1) {
    const t = tiles[i];
    if (x >= t.x && y >= t.y && x <= t.x + t.w && y <= t.y + t.h) return t;
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

function nodeGraphMiniPerformGripAt(view, clientX, clientY) {
  const rect = view.getBoundingClientRect();
  const settings = nodeGraphMiniPerformSettings();
  // Grip on the corner away from the anchor corner (Workspace: bottom right).
  const corner = settings.anchor === "workspace" ? "topLeft" : settings.corner;
  const gx = corner.endsWith("Right") ? rect.left : rect.right;
  const gy = corner.startsWith("bottom") ? rect.top : rect.bottom;
  const hit = Math.abs(clientX - gx) <= 14 && Math.abs(clientY - gy) <= 14;
  return hit ? { sign: corner.endsWith("Right") ? -1 : 1 } : null;
}

function beginNodeGraphMiniPerformPointer(event) {
  const view = document.getElementById("nodeMiniPerformView");
  if (!view || event.button !== 0 || nodeGraphMiniPerformSettings().pointer !== "interactive") return;
  event.preventDefault();
  event.stopPropagation();
  const settings = nodeGraphMiniPerformSettings();
  const rect = view.getBoundingClientRect();
  const host = document.getElementById("nodeGraphWorkspace");
  const hostRect = host.getBoundingClientRect();
  const grip = nodeGraphMiniPerformGripAt(view, event.clientX, event.clientY);
  const drag = {
    id: event.pointerId,
    x0: event.clientX,
    y0: event.clientY,
    rect,
    hostRect,
    grip,
    width0: settings.width,
    world0: { x: settings.worldX || 0, y: settings.worldY || 0 },
    moved: false,
  };
  try { view.setPointerCapture(event.pointerId); } catch (_error) { /* not active */ }
  const move = (e) => {
    if (e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    const zoom = settings.anchor === "workspace" ? nodeGraphMiniPerformCamera().zoom : 1;
    if (drag.grip) {
      setNodeGraphMiniPerformSettings({ width: drag.width0 + (drag.grip.sign * dx) / zoom }, { persist: false });
    } else if (settings.anchor === "workspace") {
      setNodeGraphMiniPerformSettings({ worldX: drag.world0.x + dx / zoom, worldY: drag.world0.y + dy / zoom }, { persist: false });
    } else {
      // Screen: follow the pointer, then snap to the nearest corner on release.
      view.style.left = `${drag.rect.left - drag.hostRect.left + dx}px`;
      view.style.top = `${drag.rect.top - drag.hostRect.top + dy}px`;
      view._miniDragging = true;
    }
  };
  const up = (e) => {
    if (e.pointerId !== drag.id) return;
    view.removeEventListener("pointermove", move);
    view.removeEventListener("pointerup", up);
    view.removeEventListener("pointercancel", up);
    view._miniDragging = false;
    if (!drag.moved) {
      nodeGraphMiniPerformClick(e);
      return;
    }
    if (!drag.grip && settings.anchor !== "workspace") {
      const left = drag.rect.left - drag.hostRect.left + (e.clientX - drag.x0);
      const top = drag.rect.top - drag.hostRect.top + (e.clientY - drag.y0);
      const w = drag.rect.width;
      const h = drag.rect.height;
      const hw = drag.hostRect.width;
      const hh = drag.hostRect.height;
      const right = left + w / 2 > hw / 2;
      const bottom = top + h / 2 > hh / 2;
      const mx = right ? hw - left - w : left;
      const my = bottom ? hh - top - h : top;
      setNodeGraphMiniPerformSettings({
        corner: `${bottom ? "bottom" : "top"}${right ? "Right" : "Left"}`,
        margin: Math.min(Math.max(0, mx), Math.max(0, my)),
      });
    } else {
      saveNodeGraphMiniPerformSettings();
    }
  };
  view.addEventListener("pointermove", move);
  view.addEventListener("pointerup", up);
  view.addEventListener("pointercancel", up);
}

function nodeGraphMiniPerformClick(event) {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const last = nodeGraphMiniPerformClick._last || 0;
  nodeGraphMiniPerformClick._last = now;
  if (now - last < 320) {
    // Double click / double tap: open F perform (the mini view hides itself while F is up).
    nodeGraphMiniPerformClick._last = 0;
    if (typeof nodeGraphLayoutCanvasMode === "function" && nodeGraphLayoutCanvasMode() === "off"
      && typeof toggleNodeGraphLayoutCanvasView === "function") {
      toggleNodeGraphLayoutCanvasView();
    }
    return;
  }
  const tile = nodeGraphMiniPerformTileAt(event.clientX, event.clientY);
  if (tile) nodeGraphMiniPerformFocusNode(tile.nodeId);
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
    if (!panel.hidden && typeof pulseNodeGraphFloatingWindowAttention === "function") {
      openNodeGraphUnifiedWindowPage("miniPerform");
      return;
    }
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

function renderNodeGraphMiniPerformPage() {
  const body = document.getElementById("nodeMiniPerformPageBody");
  if (!body) return;
  if (body.dataset.miniPerformReady !== "true") {
    body.dataset.miniPerformReady = "true";
    const note = document.createElement("p");
    note.id = "nodeMiniPerformNote";
    note.className = "node-mini-perform-note";
    note.textContent = "Only in the circuit builder.";
    const rows = [
      nodeGraphMiniPerformRow("Show mini view (Shift+F)", nodeGraphMiniPerformInput("show", "checkbox")),
      nodeGraphMiniPerformRow("Anchor", nodeGraphMiniPerformSelect("anchor")),
      nodeGraphMiniPerformRow("Corner", nodeGraphMiniPerformSelect("corner")),
      nodeGraphMiniPerformRow("Margin (px)", nodeGraphMiniPerformInput("margin", "number", { min: 0, max: 200, step: 1 })),
      nodeGraphMiniPerformRow("Width (px)", nodeGraphMiniPerformInput("width", "number", { min: 120, max: 1600, step: 10 })),
      nodeGraphMiniPerformRow("Reference screen", nodeGraphMiniPerformSelect("reference")),
      nodeGraphMiniPerformRow("Opacity", nodeGraphMiniPerformInput("opacity", "range", { min: 0.1, max: 1, step: 0.05 })),
      nodeGraphMiniPerformRow("Pointer", nodeGraphMiniPerformSelect("pointer")),
      nodeGraphMiniPerformRow("Refresh rate", nodeGraphMiniPerformSelect("refresh")),
      nodeGraphMiniPerformRow("Show frame", nodeGraphMiniPerformInput("frame", "checkbox")),
    ];
    body.replaceChildren(note, ...rows);
    body.addEventListener("change", handleNodeGraphMiniPerformControl);
    body.addEventListener("input", handleNodeGraphMiniPerformControl);
  }
  syncNodeGraphMiniPerformPage();
}

function handleNodeGraphMiniPerformControl(event) {
  const control = event.target;
  const key = control?.dataset?.miniPerformKey;
  if (!key) return;
  // Number boxes commit on change only, so typing "3" toward "360" does not clamp.
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
    control.disabled = !allowed;
    if (document.activeElement === control && control.type === "number") continue;
    if (control.type === "checkbox") control.checked = Boolean(settings[key]);
    else control.value = String(settings[key]);
    if (key === "corner" || key === "margin") control.closest("label").hidden = settings.anchor === "workspace";
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
    nodeGraphMvp.miniPerform = null;
    setNodeGraphMiniPerformSettings({}, { persist: false });
  });
  nodeGraphMiniPerformEnsureLoop();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindNodeGraphMiniPerformPageEvents, { once: true });
  } else {
    bindNodeGraphMiniPerformPageEvents();
  }
}