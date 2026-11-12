// Performance view: pinned displays fullscreen (Show performance view button + F).
// F cycle: off → perform → edit (arrange) → off.
// Arrange mode: thin white phone-aspect guides (9:19.5); G toggles vertical/horizontal.
// Freeform x/y/w/h only — no auto-grid / auto-organize.
// Root → patch.view.canvases.root; metamodule → byMetamodule[metaId].

function nodeGraphLayoutCanvasEnsureView(patch = nodeGraphMvp?.patch) {
  if (!patch || typeof patch !== "object") {
    return null;
  }
  if (!patch.view || typeof patch.view !== "object") {
    patch.view = {};
  }
  if (!patch.view.canvases || typeof patch.view.canvases !== "object") {
    patch.view.canvases = { root: { elements: [] }, byMetamodule: {} };
  }
  if (!patch.view.canvases.root || typeof patch.view.canvases.root !== "object") {
    patch.view.canvases.root = { elements: [] };
  }
  if (!Array.isArray(patch.view.canvases.root.elements)) {
    patch.view.canvases.root.elements = [];
  }
  if (!patch.view.canvases.byMetamodule || typeof patch.view.canvases.byMetamodule !== "object") {
    patch.view.canvases.byMetamodule = {};
  }
  return patch.view.canvases;
}

function nodeGraphLayoutCanvasActiveScopeId() {
  if (typeof nodeGraphMetamoduleViewId === "function") {
    const id = String(nodeGraphMetamoduleViewId() || "").trim();
    if (id) {
      return id;
    }
  }
  return "";
}

/** Root canvas when scopeId is empty; otherwise that metamodule's canvas bucket. */
function nodeGraphLayoutCanvasBucketForScope(scopeId, patch = nodeGraphMvp?.patch) {
  const canvases = nodeGraphLayoutCanvasEnsureView(patch);
  if (!canvases) {
    return { elements: [] };
  }
  const id = String(scopeId || "").trim();
  if (!id) {
    return canvases.root;
  }
  if (!canvases.byMetamodule[id] || typeof canvases.byMetamodule[id] !== "object") {
    canvases.byMetamodule[id] = { elements: [] };
  }
  if (!Array.isArray(canvases.byMetamodule[id].elements)) {
    canvases.byMetamodule[id].elements = [];
  }
  return canvases.byMetamodule[id];
}

function nodeGraphLayoutCanvasBucket(patch = nodeGraphMvp?.patch) {
  return nodeGraphLayoutCanvasBucketForScope(nodeGraphLayoutCanvasActiveScopeId(), patch);
}

/** Owned children pin on their parent Meta; everyone else uses the current view. */
function nodeGraphLayoutCanvasScopeIdForNode(nodeId, patch = nodeGraphMvp?.patch) {
  const id = String(nodeId || "").trim();
  const fromPatch = Array.isArray(patch?.nodes)
    ? patch.nodes.find((node) => String(node?.id || "") === id)
    : null;
  const live = !fromPatch && typeof nodeGraphPatchNode === "function"
    ? nodeGraphPatchNode(id)
    : null;
  const owner = String((fromPatch || live)?.ownerMetamoduleId || "").trim();
  if (owner) {
    return owner;
  }
  return nodeGraphLayoutCanvasActiveScopeId();
}

function nodeGraphLayoutCanvasElements(patch = nodeGraphMvp?.patch) {
  const bucket = nodeGraphLayoutCanvasBucket(patch);
  return Array.isArray(bucket?.elements) ? bucket.elements : [];
}

function nodeGraphLayoutCanvasPinnedElementsForScope(scopeId, patch = nodeGraphMvp?.patch) {
  return nodeGraphLayoutCanvasBucketForScope(scopeId, patch).elements
    .filter((el) => el && el.enabled !== false && String(el.nodeId || "").trim())
    .slice()
    .sort((a, b) => (Number(a.z) || 0) - (Number(b.z) || 0));
}

function nodeGraphLayoutCanvasLiveNodeIds(patch = nodeGraphMvp?.patch) {
  const live = new Set();
  const nodes = Array.isArray(patch?.nodes) ? patch.nodes : [];
  for (let i = 0; i < nodes.length; i += 1) {
    const id = String(nodes[i]?.id || "").trim();
    if (id) live.add(id);
  }
  return live;
}

function nodeGraphLayoutCanvasPruneMissingPins(patch = nodeGraphMvp?.patch) {
  const canvases = patch?.view?.canvases;
  if (!canvases || typeof canvases !== "object") {
    return false;
  }
  // A deleted Output / Input keeps its pin for its respawn (its id is its type).
  const live = nodeGraphLayoutCanvasLiveNodeIds(patch);
  for (const type of Object.keys(patch?.ioModuleSettings || {})) {
    live.add(type);
  }
  const pruneBucket = (bucket) => {
    if (!bucket || !Array.isArray(bucket.elements)) {
      return false;
    }
    const next = bucket.elements.filter((el) => live.has(String(el?.nodeId || "").trim()));
    if (next.length === bucket.elements.length) {
      return false;
    }
    bucket.elements = next;
    return true;
  };
  let changed = pruneBucket(canvases.root);
  const byMeta = canvases.byMetamodule && typeof canvases.byMetamodule === "object"
    ? canvases.byMetamodule
    : null;
  if (byMeta) {
    for (const key of Object.keys(byMeta)) {
      if (pruneBucket(byMeta[key])) changed = true;
    }
  }
  return changed;
}

function nodeGraphLayoutCanvasPinnedNodeIds(patch = nodeGraphMvp?.patch) {
  nodeGraphLayoutCanvasPruneMissingPins(patch);
  const live = nodeGraphLayoutCanvasLiveNodeIds(patch);
  const nodes = Array.isArray(patch?.nodes) ? patch.nodes : [];
  for (let i = 0; i < nodes.length; i += 1) {
    const id = String(nodes[i]?.id || "").trim();
    if (!id || !nodes[i]?.ui?.showInCanvas || !live.has(id)) continue;
    if (!nodeGraphLayoutCanvasIsPinnedInScope(id, nodeGraphLayoutCanvasScopeIdForNode(id, patch), patch)) {
      nodeGraphLayoutCanvasSetPinned(id, true, { persist: false, refresh: false, patch });
    }
  }
  return nodeGraphLayoutCanvasElements(patch)
    .filter((el) => el && el.enabled !== false && live.has(String(el.nodeId || "").trim()))
    .map((el) => String(el.nodeId || "").trim())
    .filter(Boolean);
}

function nodeGraphLayoutCanvasIsPinnedInScope(nodeId, scopeId, patch = nodeGraphMvp?.patch) {
  const id = String(nodeId || "").trim();
  if (!id) {
    return false;
  }
  return nodeGraphLayoutCanvasBucketForScope(scopeId, patch).elements
    .some((el) => el && el.enabled !== false && String(el.nodeId || "") === id);
}

function nodeGraphLayoutCanvasNodeWantsCanvas(nodeId, patch = nodeGraphMvp?.patch) {
  const id = String(nodeId || "").trim();
  const node = Array.isArray(patch?.nodes)
    ? patch.nodes.find((entry) => String(entry?.id || "") === id)
    : null;
  return Boolean(node?.ui?.showInCanvas);
}

function nodeGraphLayoutCanvasIsPinned(nodeId, patch = nodeGraphMvp?.patch) {
  const id = String(nodeId || "").trim();
  if (!id) {
    return false;
  }
  if (nodeGraphLayoutCanvasIsPinnedInScope(
    id,
    nodeGraphLayoutCanvasScopeIdForNode(id, patch),
    patch,
  )) {
    return true;
  }
  // The module flag survives a canvas-bucket rebuild. Heal the pin from it.
  if (nodeGraphLayoutCanvasNodeWantsCanvas(id, patch)) {
    nodeGraphLayoutCanvasSetPinned(id, true, { persist: false, refresh: false, patch });
    return true;
  }
  return false;
}

function nodeGraphLayoutCanvasNormalizeRect(raw, index = 0) {
  return SoemMath.normalizeCanvasTileRect(raw, index);
}

function nodeGraphLayoutCanvasElementForNode(nodeId, patch = nodeGraphMvp?.patch) {
  const id = String(nodeId || "").trim();
  return nodeGraphLayoutCanvasElements(patch).find((el) => String(el?.nodeId || "") === id) || null;
}

function nodeGraphLayoutCanvasSetPinned(nodeId, pinned, options = {}) {
  const id = String(nodeId || "").trim();
  const patch = options.patch || nodeGraphMvp?.patch;
  if (!id || !patch) {
    return false;
  }
  const scopeId = Object.prototype.hasOwnProperty.call(options, "scopeId")
    ? String(options.scopeId || "")
    : nodeGraphLayoutCanvasScopeIdForNode(id, patch);
  const bucket = nodeGraphLayoutCanvasBucketForScope(scopeId, patch);
  const els = bucket.elements;
  const idx = els.findIndex((el) => String(el?.nodeId || "") === id);
  const on = Boolean(pinned);
  const nodes = Array.isArray(patch.nodes) ? patch.nodes : [];
  const node = nodes.find((entry) => String(entry?.id || "") === id);
  if (node) {
    if (!node.ui || typeof node.ui !== "object") {
      node.ui = {};
    }
    node.ui.showInCanvas = on;
    // Show module: the tile is the whole module instead of its display.
    if (Object.prototype.hasOwnProperty.call(options, "wholeModule")) {
      if (on && options.wholeModule) {
        node.ui.canvasWholeModule = true;
      } else {
        delete node.ui.canvasWholeModule;
      }
    }
  }
  if (on) {
    if (idx >= 0) {
      els[idx].enabled = true;
      Object.assign(els[idx], nodeGraphLayoutCanvasNormalizeRect(els[idx], idx));
    } else {
      els.push({
        nodeId: id,
        enabled: true,
        ...nodeGraphLayoutCanvasNormalizeRect(null, els.length),
      });
    }
  } else if (idx >= 0) {
    els.splice(idx, 1);
  }
  if (options.persist !== false && typeof markNodeGraphPatchDirty === "function") {
    markNodeGraphPatchDirty();
  }
  if (options.refresh !== false && nodeGraphLayoutCanvasMode() !== "off") {
    nodeGraphLayoutCanvasRefreshOpenStage();
  }
  if (options.refresh !== false && typeof nodeGraphMetamoduleRefreshAllMirrors === "function") {
    nodeGraphMetamoduleRefreshAllMirrors();
  }
  return true;
}

function nodeGraphLayoutCanvasWriteRect(nodeId, rect, options = {}) {
  const id = String(nodeId || "").trim();
  const patch = options.patch || nodeGraphMvp?.patch;
  if (!id || !patch) {
    return false;
  }
  const el = nodeGraphLayoutCanvasElementForNode(id, patch);
  if (!el) {
    return false;
  }
  Object.assign(el, nodeGraphLayoutCanvasNormalizeRect({ ...el, ...rect }, el.z || 0));
  if (options.persist !== false && typeof markNodeGraphPatchDirty === "function") {
    markNodeGraphPatchDirty();
  }
  return true;
}

/** Live pins of the current Canvas, back to front (stable on equal z). */
function nodeGraphLayoutCanvasStackOrder(patch = nodeGraphMvp?.patch) {
  const live = nodeGraphLayoutCanvasLiveNodeIds(patch);
  return nodeGraphLayoutCanvasElements(patch)
    .filter((el) => el && el.enabled !== false && live.has(String(el.nodeId || "").trim()))
    .slice()
    .sort((a, b) => (Number(a.z) || 0) - (Number(b.z) || 0));
}

/**
 * Arrange z-order: the one place a Canvas tile's stack index changes (no
 * raise-on-click). Rewrites the stack as z = 0..n-1 so every step is one layer.
 * step: "back" | "backward" | "forward" | "front".
 */
function nodeGraphLayoutCanvasRestack(nodeId, step, options = {}) {
  const id = String(nodeId || "").trim();
  const patch = options.patch || nodeGraphMvp?.patch;
  if (!id || !patch) {
    return false;
  }
  const order = nodeGraphLayoutCanvasStackOrder(patch);
  const from = order.findIndex((el) => String(el.nodeId || "") === id);
  if (from < 0) {
    return false;
  }
  const last = order.length - 1;
  const to = {
    back: 0,
    backward: Math.max(0, from - 1),
    forward: Math.min(last, from + 1),
    front: last,
  }[step];
  if (!Number.isFinite(to) || to === from) {
    return false;
  }
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  order.forEach((el, index) => {
    el.z = index;
  });
  if (options.persist !== false && typeof markNodeGraphPatchDirty === "function") {
    markNodeGraphPatchDirty();
  }
  nodeGraphLayoutCanvasReapplyTileRects();
  nodeGraphLayoutCanvasSyncArrangeBar();
  return true;
}

/** Re-place every live tile from its stored rect (position, size, stack). */
function nodeGraphLayoutCanvasReapplyTileRects() {
  const stage = document.getElementById("nodeScreenSoloStage");
  if (!(stage instanceof HTMLElement)) {
    return;
  }
  stage.querySelectorAll(".node-layout-canvas-tile").forEach((tile) => {
    const el = nodeGraphLayoutCanvasElementForNode(String(tile.dataset.node || ""));
    nodeGraphLayoutCanvasApplyTileRect(tile, el || {
      x: tile.dataset.canvasX,
      y: tile.dataset.canvasY,
      w: tile.dataset.canvasW,
      h: tile.dataset.canvasH,
    }, stage);
  });
}

/** The tile the Arrange bar acts on: the most recently selected module with a tile. */
function nodeGraphLayoutCanvasArrangeTargetId() {
  const stage = document.getElementById("nodeScreenSoloStage");
  if (!(stage instanceof HTMLElement)) {
    return "";
  }
  const tiles = new Set(Array.from(stage.querySelectorAll(".node-layout-canvas-tile"))
    .map((tile) => String(tile.dataset.node || "")));
  const ids = nodeGraphLayoutCanvasSelectionIds().filter((id) => tiles.has(id));
  return ids.length ? ids[ids.length - 1] : "";
}

/**
 * Arrange blend: how a Canvas tile composites over the tiles behind it. The
 * one writer of the pin's `blend` (saved with the patch; "normal" = no field).
 */
function nodeGraphLayoutCanvasSetBlend(nodeId, blend, options = {}) {
  const id = String(nodeId || "").trim();
  const patch = options.patch || nodeGraphMvp?.patch;
  const el = id && patch ? nodeGraphLayoutCanvasElementForNode(id, patch) : null;
  if (!el) {
    return false;
  }
  const next = SoemMath.normalizeCanvasTileBlend(blend);
  if (SoemMath.normalizeCanvasTileBlend(el.blend) === next) {
    return false;
  }
  if (next === "normal") {
    delete el.blend;
  } else {
    el.blend = next;
  }
  if (options.persist !== false && typeof markNodeGraphPatchDirty === "function") {
    markNodeGraphPatchDirty();
  }
  nodeGraphLayoutCanvasReapplyTileRects();
  nodeGraphLayoutCanvasSyncArrangeBar();
  if (typeof nodeGraphMiniPerformShown === "function" && nodeGraphMiniPerformShown()
    && typeof nodeGraphGlMiniPerformPresent === "function") {
    nodeGraphGlMiniPerformPresent();
  }
  return true;
}

/** The current Canvas's background image ({ dataUrl, fileName }) or null. Read only. */
function nodeGraphLayoutCanvasBackground(patch = nodeGraphMvp?.patch) {
  const canvases = patch?.view?.canvases;
  const scope = nodeGraphLayoutCanvasActiveScopeId();
  const bucket = scope ? canvases?.byMetamodule?.[scope] : canvases?.root;
  return nodeGraphNormalizeCanvasBackground(bucket?.background);
}

/**
 * Canvas background: the one writer of the current Canvas's `background`
 * (saved with the patch next to its pins; null clears it). Tiles keep their
 * blend and now blend over the picture.
 */
function nodeGraphLayoutCanvasSetBackground(asset, options = {}) {
  const patch = options.patch || nodeGraphMvp?.patch;
  if (!patch) {
    return false;
  }
  const bucket = nodeGraphLayoutCanvasBucket(patch);
  const next = nodeGraphNormalizeCanvasBackground(asset);
  const before = nodeGraphNormalizeCanvasBackground(bucket.background);
  if ((next?.dataUrl || "") === (before?.dataUrl || "") && (next?.fileName || "") === (before?.fileName || "")) {
    return false;
  }
  if (next) {
    bucket.background = next;
  } else {
    delete bucket.background;
  }
  if (options.persist !== false && typeof markNodeGraphPatchDirty === "function") {
    markNodeGraphPatchDirty();
  }
  nodeGraphLayoutCanvasApplyBackground(document.getElementById("nodeScreenSoloStage"));
  nodeGraphLayoutCanvasSyncArrangeBar();
  if (typeof nodeGraphMiniPerformShown === "function" && nodeGraphMiniPerformShown()
    && typeof nodeGraphGlMiniPerformPresent === "function") {
    nodeGraphGlMiniPerformPresent();
  }
  return true;
}

/**
 * Canvas stage background: the image covers the stage (CSS cover, see
 * styles.css) behind every tile and the Arrange chrome. Off the Canvas the
 * shared stage goes back to plain black.
 */
function nodeGraphLayoutCanvasApplyBackground(stage) {
  if (!(stage instanceof HTMLElement)) {
    return;
  }
  const asset = stage.classList.contains("node-layout-canvas-stage") ? nodeGraphLayoutCanvasBackground() : null;
  const url = asset ? asset.dataUrl : "";
  if (stage._canvasBackgroundUrl === url) {
    return;
  }
  stage._canvasBackgroundUrl = url;
  if (url) {
    stage.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
  } else {
    stage.style.removeProperty("background-image");
  }
}

// Decoded Canvas background for the Mini Canvas GL pass (one image per data URL).
const nodeGraphLayoutCanvasBackgroundPicture = { dataUrl: "", image: null };

/** The current Canvas background as a loaded image, or null (none set, or still decoding). */
function nodeGraphLayoutCanvasBackgroundImage() {
  const asset = nodeGraphLayoutCanvasBackground();
  const cache = nodeGraphLayoutCanvasBackgroundPicture;
  if (!asset) {
    cache.dataUrl = "";
    cache.image = null;
    return null;
  }
  if (cache.dataUrl !== asset.dataUrl) {
    const image = new Image();
    image.decoding = "async";
    image.src = asset.dataUrl;
    cache.dataUrl = asset.dataUrl;
    cache.image = image;
  }
  return cache.image.complete && cache.image.naturalWidth > 0 ? cache.image : null;
}

const NODE_GRAPH_LAYOUT_CANVAS_RESTACK_STEPS = Object.freeze([
  ["back", "To back"],
  ["backward", "Back one"],
  ["forward", "Forward one"],
  ["front", "To front"],
]);

function nodeGraphLayoutCanvasEnsureArrangeBar() {
  let bar = document.getElementById("nodeLayoutCanvasArrangeBar");
  if (bar) {
    return bar;
  }
  bar = document.createElement("div");
  bar.id = "nodeLayoutCanvasArrangeBar";
  bar.className = "node-layout-canvas-arrange-bar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Canvas layer order, blend and background");
  const label = document.createElement("span");
  label.className = "node-layout-canvas-arrange-label";
  bar.append(label);
  for (const [step, text] of NODE_GRAPH_LAYOUT_CANVAS_RESTACK_STEPS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.restack = step;
    button.textContent = text;
    bar.append(button);
  }
  // Blend group wraps as one row on a narrow (phone) screen.
  const blendGroup = document.createElement("div");
  blendGroup.className = "node-layout-canvas-arrange-blend";
  blendGroup.setAttribute("role", "group");
  blendGroup.setAttribute("aria-label", "Blend");
  const blendLabel = document.createElement("span");
  blendLabel.className = "node-layout-canvas-arrange-label";
  blendLabel.textContent = "Blend";
  blendGroup.append(blendLabel);
  for (const name of SoemMath.CANVAS_TILE_BLENDS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.blend = name;
    button.textContent = NODE_GRAPH_CANVAS_TILE_BLEND_UI[name]?.label || name;
    blendGroup.append(button);
  }
  bar.append(blendGroup);
  // Background: the whole Canvas, not the selected tile.
  const backgroundGroup = document.createElement("div");
  backgroundGroup.className = "node-layout-canvas-arrange-background";
  backgroundGroup.setAttribute("role", "group");
  backgroundGroup.setAttribute("aria-label", "Background");
  const backgroundLabel = document.createElement("span");
  backgroundLabel.className = "node-layout-canvas-arrange-label";
  backgroundLabel.textContent = "Background";
  backgroundGroup.append(backgroundLabel);
  for (const action of ["pick", "clear"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.background = action;
    button.textContent = action === "pick" ? "Add image" : "Clear";
    backgroundGroup.append(button);
  }
  bar.append(backgroundGroup);
  bar.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button[data-restack], button[data-blend], button[data-background]");
    const background = button?.dataset?.background;
    if (background === "pick") {
      nodeGraphPickImageFile((asset) => nodeGraphLayoutCanvasSetBackground(asset));
      return;
    }
    if (background === "clear") {
      nodeGraphLayoutCanvasSetBackground(null);
      return;
    }
    const step = button?.dataset?.restack;
    const blend = button?.dataset?.blend;
    const id = nodeGraphLayoutCanvasArrangeTargetId();
    const changed = step
      ? nodeGraphLayoutCanvasRestack(id, step)
      : (blend ? nodeGraphLayoutCanvasSetBlend(id, blend) : true);
    if (!changed) {
      nodeGraphLayoutCanvasSyncArrangeBar();
    }
  });
  bar.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  document.body.append(bar);
  return bar;
}

/** Arrange bar label / buttons and the target tile's frame follow the selection. */
function nodeGraphLayoutCanvasSyncArrangeBar() {
  const stage = document.getElementById("nodeScreenSoloStage");
  const editing = nodeGraphLayoutCanvasMode() === "edit"
    && Boolean(stage?.querySelector(".node-layout-canvas-tile"));
  const existing = document.getElementById("nodeLayoutCanvasArrangeBar");
  if (!editing) {
    if (existing) existing.hidden = true;
    stage?.querySelectorAll(".node-layout-canvas-tile.is-arrange-target")
      .forEach((tile) => tile.classList.remove("is-arrange-target"));
    return;
  }
  const bar = existing || nodeGraphLayoutCanvasEnsureArrangeBar();
  bar.hidden = false;
  const id = nodeGraphLayoutCanvasArrangeTargetId();
  stage.querySelectorAll(".node-layout-canvas-tile").forEach((tile) => {
    tile.classList.toggle("is-arrange-target", Boolean(id) && String(tile.dataset.node || "") === id);
  });
  const order = nodeGraphLayoutCanvasStackOrder();
  const index = order.findIndex((el) => String(el.nodeId || "") === id);
  const node = id && typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(id) : null;
  const name = node && typeof nodeGraphTraceDisplaySettingsTargetLabel === "function"
    ? nodeGraphTraceDisplaySettingsTargetLabel(node)
    : (node?.type || "");
  const label = bar.querySelector(".node-layout-canvas-arrange-label");
  if (label) {
    label.textContent = index >= 0
      ? `${name ? `${name}: ` : ""}layer ${index + 1} of ${order.length}`
      : "Tap a display to order or blend it";
  }
  bar.querySelectorAll("button[data-restack]").forEach((button) => {
    const step = button.dataset.restack;
    const atBack = index <= 0;
    const atFront = index < 0 || index >= order.length - 1;
    button.disabled = index < 0
      || ((step === "back" || step === "backward") && atBack)
      || ((step === "front" || step === "forward") && atFront);
  });
  const blend = SoemMath.normalizeCanvasTileBlend(index >= 0 ? order[index].blend : "");
  bar.querySelectorAll("button[data-blend]").forEach((button) => {
    button.disabled = index < 0;
    button.setAttribute("aria-pressed", String(index >= 0 && button.dataset.blend === blend));
  });
  const hasBackground = Boolean(nodeGraphLayoutCanvasBackground());
  const pick = bar.querySelector('button[data-background="pick"]');
  if (pick) {
    pick.textContent = hasBackground ? "Change image" : "Add image";
  }
  const clear = bar.querySelector('button[data-background="clear"]');
  if (clear) {
    clear.disabled = !hasBackground;
  }
}

/** @returns {"off"|"perform"|"edit"} */
function nodeGraphLayoutCanvasMode() {
  const mode = String(nodeGraphMvp?.layoutCanvasMode || "").trim();
  if (mode === "perform" || mode === "edit") {
    return mode;
  }
  if (nodeGraphMvp?.layoutCanvasActive) {
    return "perform";
  }
  return "off";
}

function nodeGraphLayoutCanvasIsActive() {
  return nodeGraphLayoutCanvasMode() !== "off";
}

function nodeGraphLayoutCanvasApplyTileRect(tile, rect, stage) {
  if (!(tile instanceof HTMLElement) || !(stage instanceof HTMLElement)) {
    return;
  }
  // Shared with the Mini Performance View (node-graph-canvas-fit.js).
  const px = nodeGraphCanvasTileRectPx(rect, stage.clientWidth, stage.clientHeight);
  const r = px.rect;
  tile.style.left = `${px.x}px`;
  tile.style.top = `${px.y}px`;
  tile.style.width = `${px.w}px`;
  tile.style.height = `${px.h}px`;
  tile.style.zIndex = String(100 + (r.z || 0));
  // Blend with the tiles behind it (the stage is the stacking context).
  nodeGraphCanvasTileApplyBlend(tile, r.blend);
  const textFace = tile.querySelector(".node-text-box-body");
  if (textFace && typeof nodeGraphTextBoxApplyCanvasScale === "function") {
    nodeGraphTextBoxApplyCanvasScale(textFace);
  }
  tile.dataset.canvasX = String(r.x);
  tile.dataset.canvasY = String(r.y);
  tile.dataset.canvasW = String(r.w);
  tile.dataset.canvasH = String(r.h);
}

function nodeGraphLayoutCanvasClearStageChrome(stage) {
  if (!(stage instanceof HTMLElement)) {
    return;
  }
  stage.classList.remove("node-layout-canvas-stage", "node-layout-canvas-edit");
  nodeGraphLayoutCanvasApplyBackground(stage);
  stage.querySelectorAll(".node-layout-canvas-tile").forEach((tile) => {
    const face = tile.querySelector(".node-screen-solo-face, .node-layout-canvas-face");
    if (face && tile.parentNode) {
      tile.replaceWith(face);
    } else {
      tile.remove();
    }
  });
}

/**
 * Freeform stage: reparent faces into absolute tiles from persisted rects.
 * Does NOT auto-grid / auto-organize existing pins.
 */
function beginNodeGraphLayoutCanvasStage(nodeIds, mode = "perform") {
  const ids = (Array.isArray(nodeIds) ? nodeIds : []).map((id) => String(id || "").trim()).filter(Boolean);
  if (!ids.length || typeof nodeGraphScreenSoloCollectFaces !== "function") {
    return false;
  }
  // Faces may currently sit on a Metamodule shell canvas — put them back first.
  if (typeof nodeGraphMetamoduleRestoreCanvasSessionsForNodes === "function") {
    nodeGraphMetamoduleRestoreCanvasSessionsForNodes(ids);
  }
  if (typeof nodeGraphSyncMetamoduleVisibilityToDom === "function") {
    nodeGraphSyncMetamoduleVisibilityToDom();
  }
  if (typeof endNodeGraphScreenSolo === "function") {
    endNodeGraphScreenSolo({ silent: true });
  }
  // Hide whole-module tiles' In/Out (same state as the In/Out toggle) before the
  // tiles capture their zoom-1 size, so the IO band is not part of the tile.
  // (After endNodeGraphScreenSolo, which clears it on every exit / re-open.)
  nodeGraphLayoutCanvasSetIoHidden(true);
  const collected = nodeGraphScreenSoloCollectFaces(ids);
  if (!collected.length) {
    return false;
  }
  const session = typeof nodeGraphScreenSoloSession === "function"
    ? nodeGraphScreenSoloSession()
    : (nodeGraphMvp.screenSolo = nodeGraphMvp.screenSolo || { items: [] });
  const stage = typeof ensureNodeGraphScreenSoloStage === "function"
    ? ensureNodeGraphScreenSoloStage()
    : document.getElementById("nodeScreenSoloStage");
  if (!stage) {
    return false;
  }
  nodeGraphLayoutCanvasClearStageChrome(stage);

  const items = [];
  const patch = nodeGraphMvp?.patch;
  for (let i = 0; i < collected.length; i += 1) {
    const entry = collected[i];
    const parent = entry.face.parentNode;
    if (!parent) {
      continue;
    }
    const savedLayout = typeof nodeGraphScreenSoloCaptureFaceLayout === "function"
      ? nodeGraphScreenSoloCaptureFaceLayout(entry.face)
      : { gridColumn: "", gridRow: "" };
    const nextSibling = entry.face.nextSibling;
    const placeholder = document.createElement("div");
    placeholder.className = "node-screen-solo-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    parent.insertBefore(placeholder, entry.face);
    if (!entry.face.dataset.node) {
      entry.face.dataset.node = entry.id;
    }
    entry.host?.classList.add("node-screen-solo-host");
    // Whole-module faces keep their own zoom-1 layout: no solo-face stretch rules.
    if (!entry.face.classList.contains("node-whole-module-face")) {
      entry.face.classList.add("node-screen-solo-face", "node-layout-canvas-face");
    }
    // B-071: plate metrics before reparent — tile stretch must not redefine source-min.
    if (typeof nodeGraphTextBoxCaptureCanvasScaleSource === "function") {
      nodeGraphTextBoxCaptureCanvasScaleSource(entry.face);
    }
    // Line faces (DSF / BLIT / SinCos): builder ink size, once, before reparent.
    if (typeof nodeGraphGlLinesCaptureBuilderSize === "function") {
      nodeGraphGlLinesCaptureBuilderSize(entry.face);
    }

    const tile = document.createElement("div");
    tile.className = "node-layout-canvas-tile";
    tile.dataset.node = entry.id;
    tile.append(entry.face);

    const frame = document.createElement("div");
    frame.className = "node-layout-canvas-frame";
    frame.setAttribute("aria-hidden", "true");
    tile.append(frame);

    for (const corner of ["nw", "ne", "sw", "se"]) {
      const grip = document.createElement("div");
      grip.className = `node-layout-canvas-grip node-layout-canvas-grip-${corner}`;
      grip.dataset.corner = corner;
      grip.setAttribute("aria-hidden", "true");
      tile.append(grip);
    }

    const stored = nodeGraphLayoutCanvasElementForNode(entry.id, patch);
    const rect = nodeGraphLayoutCanvasNormalizeRect(stored, i);
    if (stored) {
      Object.assign(stored, rect);
    }

    items.push({
      nodeId: entry.id,
      face: entry.face,
      host: entry.host,
      parent,
      placeholder,
      nextSibling,
      savedLayout,
      savedFaceDom: entry.savedFaceDom,
      hostWasOscilloscopeHidden: entry.hostWasOscilloscopeHidden,
      tile,
      rect,
    });
  }
  if (!items.length) {
    return false;
  }

  session.items = items.map(({ tile, ...rest }) => rest);
  // Keep tile refs for layout chrome (not in classic solo session shape).
  session.layoutCanvasTiles = items;
  session.nodeId = items[0].nodeId;
  session.face = items[0].face;
  session.host = items[0].host;
  session.parent = items[0].parent;
  session.placeholder = items[0].placeholder;
  session.layoutCanvas = true;
  session.fit = "";
  nodeGraphMvp.screenSoloNodeId = items[0].nodeId;

  document.body.classList.add("node-screen-solo-active", "node-layout-canvas-active");
  document.body.classList.toggle("node-layout-canvas-edit", mode === "edit");
  stage.hidden = false;
  stage.classList.add("node-layout-canvas-stage");
  stage.classList.toggle("node-layout-canvas-edit", mode === "edit");
  nodeGraphLayoutCanvasApplyBackground(stage);
  // Freeform — kill CSS grid auto-organize.
  stage.style.display = "block";
  stage.style.removeProperty("--node-screen-solo-cols");
  stage.style.removeProperty("--node-screen-solo-rows");

  for (const item of items) {
    stage.append(item.tile);
    nodeGraphLayoutCanvasApplyTileRect(item.tile, item.rect, stage);
    if (typeof nodeGraphScreenSoloWholeModuleFit === "function") nodeGraphScreenSoloWholeModuleFit(item.tile);
  }
  nodeGraphLayoutCanvasSyncArrangeBar();

  const relayoutKeyboardFaces = () => {
    for (const item of items) {
      nodeGraphLayoutCanvasApplyTileRect(item.tile, item.rect, stage);
    if (typeof nodeGraphScreenSoloWholeModuleFit === "function") nodeGraphScreenSoloWholeModuleFit(item.tile);
    }
    if (typeof installNodeGraphKeyboardLayoutResizeObserver === "function") {
      installNodeGraphKeyboardLayoutResizeObserver();
    }
    if (typeof applyNodeGraphKeyboardLayout === "function") {
      applyNodeGraphKeyboardLayout();
    }
    if (typeof renderNodeGraphKeyboardKeys === "function") {
      renderNodeGraphKeyboardKeys();
    }
  };

  for (const item of items) {
    if (typeof nodeGraphScreenSoloWakeFace === "function") {
      nodeGraphScreenSoloWakeFace(item.face);
    }
  }
  window.requestAnimationFrame(() => {
    relayoutKeyboardFaces();
    if (typeof nodeGraphScreenSoloRefreshPaint === "function") {
      nodeGraphScreenSoloRefreshPaint();
    }
    window.requestAnimationFrame(() => {
      relayoutKeyboardFaces();
    });
  });
  return true;
}

function nodeGraphLayoutCanvasRefreshOpenStage() {
  const mode = nodeGraphLayoutCanvasMode();
  if (mode === "off") {
    return false;
  }
  return nodeGraphLayoutCanvasOpen(mode, { silent: true });
}

function nodeGraphLayoutCanvasClearEmptyEgg() {
  if (nodeGraphMvp && typeof nodeGraphMvp === "object") nodeGraphMvp.layoutCanvasEmptyEgg = false;
  document.getElementById("nodeLayoutCanvasEmptyEgg")?.remove();
}

function nodeGraphLayoutCanvasOpenEmptyEgg(mode, options = {}) {
  const stage = typeof ensureNodeGraphScreenSoloStage === "function"
    ? ensureNodeGraphScreenSoloStage()
    : document.getElementById("nodeScreenSoloStage");
  if (!(stage instanceof HTMLElement)) return false;
  nodeGraphLayoutCanvasClearEmptyEgg();
  const canvas = document.createElement("canvas");
  canvas.id = "nodeLayoutCanvasEmptyEgg";
  canvas.className = "node-layout-canvas-empty-egg";
  canvas.setAttribute("aria-hidden", "true");
  stage.append(canvas);
  nodeGraphMvp.layoutCanvasMode = mode;
  nodeGraphMvp.layoutCanvasActive = true;
  nodeGraphMvp.layoutCanvasEmptyEgg = true;
  document.body.classList.add("node-screen-solo-active", "node-layout-canvas-active");
  document.body.classList.toggle("node-layout-canvas-edit", mode === "edit");
  stage.hidden = false;
  stage.classList.add("node-layout-canvas-stage");
  stage.classList.toggle("node-layout-canvas-edit", mode === "edit");
  stage.style.display = "block";
  stage.setAttribute("aria-label", "Canvas");
  if (options.silent !== true && typeof setNodeInteractionHelp === "function") {
    setNodeInteractionHelp(NODE_GRAPH_EMPTY_CANVAS_LINE);
  }
  if (typeof renderNodeGraphModularViewModeButtons === "function") renderNodeGraphModularViewModeButtons();
  if (typeof nodeGraphEmptyCanvasEnsureLoop === "function") nodeGraphEmptyCanvasEnsureLoop();
  return true;
}

function nodeGraphLayoutCanvasOpen(mode = "perform", options = {}) {
  if (typeof nodeGraphMiniPerformOnPerformanceViewOpening === "function") {
    nodeGraphMiniPerformOnPerformanceViewOpening();
  }
  const next = mode === "edit" ? "edit" : "perform";
  const ids = nodeGraphLayoutCanvasPinnedNodeIds();
  if (!ids.length) {
    if (nodeGraphMvp?.emptyCanvasDvdEgg === true) {
      return nodeGraphLayoutCanvasOpenEmptyEgg(next, options);
    }
    nodeGraphLayoutCanvasClearEmptyEgg();
    nodeGraphMvp.layoutCanvasMode = "off";
    nodeGraphMvp.layoutCanvasActive = false;
    if (options.silent !== true && typeof setNodeInteractionHelp === "function") {
      setNodeInteractionHelp(
        `Canvas is empty. Open Display Settings on a module and enable “${NODE_GRAPH_SHOW_IN_PERFORMANCE_VIEW_LABEL}”.`,
      );
    }
    return false;
  }
  nodeGraphLayoutCanvasClearEmptyEgg();
  const started = beginNodeGraphLayoutCanvasStage(ids, next);
  if (!started) {
    nodeGraphLayoutCanvasSetIoHidden(false);
    nodeGraphMvp.layoutCanvasMode = "off";
    nodeGraphMvp.layoutCanvasActive = false;
    if (options.silent !== true && typeof setNodeInteractionHelp === "function") {
      setNodeInteractionHelp("Pinned modules have no display faces to show on the canvas.");
    }
    return false;
  }
  nodeGraphMvp.layoutCanvasMode = next;
  nodeGraphMvp.layoutCanvasActive = true;
  if (next === "perform") {
    // Embed waits for Play on the module. Starting AudioContext here has no
    // user gesture, so Chrome suspends it and later Play stays silent.
    const embed = document.documentElement.classList.contains("soemdsp-embed");
    // Auto-start only on a performance page (perform.html, ?mode/view=perform:
    // perform-boot sets soemdspPerformPage) or the phone canvas, which have no
    // transport controls. In a normal session, entering the view never plays.
    const performPage = globalThis.soemdspPerformPage === true
      || globalThis.soemdspMobileCanvasMode === true;
    if (!embed && performPage) {
      if (typeof nodeGraphTransportHandleAction === "function") {
        nodeGraphTransportHandleAction("play");
      } else if (typeof nodeGraphExternalStartLiveOutput === "function") {
        nodeGraphExternalStartLiveOutput();
      }
    }
  }
  nodeGraphLayoutCanvasAnnounceMode(next, ids.length, options);
  return true;
}

/** Stage label + help line + view buttons for the current Performance view mode. */
function nodeGraphLayoutCanvasAnnounceMode(next, n, options = {}) {
  const stage = document.getElementById("nodeScreenSoloStage");
  if (stage) {
    stage.setAttribute(
      "aria-label",
      next === "edit"
        ? "Canvas arrange. Drag tiles to move, corners to resize, right-click for Display Settings. F exits arrange, F again exits."
        : "Canvas. F enters arrange mode, F again exits.",
    );
  }
  if (options.silent !== true && typeof setNodeInteractionHelp === "function") {
    const scope = nodeGraphLayoutCanvasActiveScopeId() ? "metamodule" : "root";
    setNodeInteractionHelp(
      next === "edit"
        ? `Canvas arrange (${scope}): move/resize ${n} display${n === 1 ? "" : "s"}, right-click for Display Settings, bottom bar sets layer order. F exits arrange.`
        : `Canvas (${scope}): ${n} display${n === 1 ? "" : "s"}. F = arrange layout.`,
    );
  }
  if (typeof renderNodeGraphModularViewModeButtons === "function") {
    renderNodeGraphModularViewModeButtons();
  }
}

/**
 * Perform <-> Arrange on a live stage: same tiles, same faces, only the edit
 * chrome flips. Rebuilding the stage (end solo + re-collect) put every face
 * back in the circuit builder for a moment, where it repainted with its
 * stale tile-size metrics; canvas view and arrange then drew the same face
 * from two different size baselines. One stage, one look.
 * Returns false when the pinned set changed (caller rebuilds).
 */
function nodeGraphLayoutCanvasSwitchModeInPlace(next) {
  if (!nodeGraphLayoutCanvasStageIsLive()) return false;
  const stage = document.getElementById("nodeScreenSoloStage");
  const tiles = Array.from(stage?.querySelectorAll(".node-layout-canvas-tile") || []);
  const ids = nodeGraphLayoutCanvasPinnedNodeIds();
  if (!tiles.length || tiles.length !== ids.length) return false;
  const have = new Set(tiles.map((tile) => String(tile.dataset.node || "")));
  if (!ids.every((id) => have.has(String(id)))) return false;
  document.body.classList.toggle("node-layout-canvas-edit", next === "edit");
  stage.classList.toggle("node-layout-canvas-edit", next === "edit");
  nodeGraphMvp.layoutCanvasMode = next;
  nodeGraphMvp.layoutCanvasActive = true;
  nodeGraphLayoutCanvasSyncArrangeBar();
  return ids.length;
}

/**
 * Canvas In/Out: flip the transient flag read by nodeGraphEffectivePatchNodeUi
 * and re-apply the affected modules through the same chrome path the In/Out
 * button uses (applyNodeGraphChromeNodesToDom). Saved ui.ioHidden never changes.
 */
function nodeGraphLayoutCanvasSetIoHidden(on) {
  const want = on === true;
  if (Boolean(nodeGraphMvp.canvasIoHidden) === want) {
    return;
  }
  nodeGraphMvp.canvasIoHidden = want;
  const ids = (nodeGraphMvp.patch?.nodes || [])
    .filter((node) => node?.ui?.canvasWholeModule)
    .map((node) => node.id);
  if (ids.length && typeof applyNodeGraphChromeNodesToDom === "function") {
    applyNodeGraphChromeNodesToDom(ids);
  }
}

function nodeGraphLayoutCanvasClose(options = {}) {
  nodeGraphLayoutCanvasClearEmptyEgg();
  // Perform / embed has no circuit builder to return to. Closing the canvas
  // is the black page. Open/refresh still calls endNodeGraphScreenSolo directly.
  if (typeof nodeGraphAppHotkeysLocked === "function" && nodeGraphAppHotkeysLocked()) {
    return false;
  }
  nodeGraphMvp.layoutCanvasMode = "off";
  nodeGraphMvp.layoutCanvasActive = false;
  const hud = document.getElementById("nodeGraphCanvasDebugHud");
  if (hud) hud.remove();
  const stage = document.getElementById("nodeScreenSoloStage");
  if (stage) {
    nodeGraphLayoutCanvasClearStageChrome(stage);
    stage.style.removeProperty("display");
  }
  document.body.classList.remove("node-layout-canvas-active", "node-layout-canvas-edit");
  nodeGraphLayoutCanvasSyncArrangeBar();
  if (typeof endNodeGraphScreenSolo === "function"
    && typeof nodeGraphScreenSoloIsActive === "function"
    && nodeGraphScreenSoloIsActive()) {
    endNodeGraphScreenSolo({ silent: options.silent === true });
  }
  if (typeof nodeGraphMetamoduleRefreshAllMirrors === "function") {
    nodeGraphMetamoduleRefreshAllMirrors();
  }
  if (options.silent !== true && typeof setNodeInteractionHelp === "function") {
    setNodeInteractionHelp("Canvas off.");
  }
  if (typeof renderNodeGraphModularViewModeButtons === "function") {
    renderNodeGraphModularViewModeButtons();
  }
  return true;
}

function nodeGraphLayoutCanvasStageIsLive() {
  if (!document.body.classList.contains("node-layout-canvas-active")) {
    return false;
  }
  if (typeof nodeGraphScreenSoloIsActive === "function" && !nodeGraphScreenSoloIsActive()) {
    return false;
  }
  const stage = document.getElementById("nodeScreenSoloStage");
  return Boolean(stage && stage.childElementCount > 0);
}

/**
 * F / Show performance view / scene menu. Metamodule selection wins, then
 * off → Perform → Arrange → off.
 */
function toggleNodeGraphPerformanceView(options = {}) {
  if (
    typeof nodeGraphMetamoduleToggleDisplaysForSelection === "function"
    && nodeGraphMetamoduleToggleDisplaysForSelection()
  ) {
    return false;
  }
  return toggleNodeGraphLayoutCanvasView(options);
}

/**
 * Performance view cycle: off → perform → edit (arrange) → off.
 * Arrange shows phone-aspect guides; G toggles vertical/horizontal.
 * No auto-organize; freeform rects only.
 */
function toggleNodeGraphLayoutCanvasView(options = {}) {
  if (typeof nodeGraphAppHotkeysLocked === "function" && nodeGraphAppHotkeysLocked()) {
    return false;
  }
  let mode = nodeGraphLayoutCanvasMode();
  // Repair desync: mode says canvas is on but stage was torn down (common after
  // heavy face layout thrash / Music Player interaction in canvas). Treat as off
  // so F can re-enter instead of silently no-oping mid-cycle.
  if ((mode === "perform" || mode === "edit") && !nodeGraphLayoutCanvasStageIsLive()) {
    nodeGraphMvp.layoutCanvasMode = "off";
    nodeGraphMvp.layoutCanvasActive = false;
    mode = "off";
  }
  if (mode === "off") {
    return nodeGraphLayoutCanvasOpen("perform", options);
  }
  if (mode === "perform") {
    const n = nodeGraphLayoutCanvasSwitchModeInPlace("edit");
    if (n) {
      nodeGraphLayoutCanvasAnnounceMode("edit", n, options);
      return true;
    }
    return nodeGraphLayoutCanvasOpen("edit", options);
  }
  return nodeGraphLayoutCanvasClose(options);
}

function nodeGraphLayoutCanvasSelectionIds() {
  const ordered = typeof nodeGraphSelectedNodeIdsInOrder === "function"
    ? nodeGraphSelectedNodeIdsInOrder()
    : [];
  return ordered.map((id) => String(id || "").trim()).filter(Boolean);
}

// Performance view pins: Show display (the module's display) and Show module
// (the whole module). One pin per module; the flag picks what the tile shows.
const NODE_GRAPH_LAYOUT_CANVAS_PIN_INPUTS = Object.freeze({
  nodeLayoutCanvasShowInCanvas: false,
  nodeLayoutCanvasShowModule: true,
});

function nodeGraphLayoutCanvasPinShows(nodeId, wholeModule) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  return nodeGraphLayoutCanvasIsPinned(nodeId) && Boolean(node?.ui?.canvasWholeModule) === wholeModule;
}

function syncNodeGraphLayoutCanvasSettingsControl() {
  const ids = nodeGraphLayoutCanvasSelectionIds();
  for (const [inputId, wholeModule] of Object.entries(NODE_GRAPH_LAYOUT_CANVAS_PIN_INPUTS)) {
    const input = document.getElementById(inputId);
    if (!(input instanceof HTMLInputElement)) {
      continue;
    }
    input.disabled = !ids.length;
    input.checked = ids.length > 0 && ids.every((id) => nodeGraphLayoutCanvasPinShows(id, wholeModule));
    const row = input.closest("label") || input.parentElement;
    if (row) {
      row.hidden = false;
      row.classList.toggle("is-disabled", !ids.length);
    }
  }
}

function nodeGraphLayoutCanvasBindTileInteractions(stage) {
  if (!(stage instanceof HTMLElement) || stage.dataset.canvasInteractBound === "true") {
    return;
  }
  stage.dataset.canvasInteractBound = "true";

  let drag = null;

  const onMove = (event) => {
    if (!drag || nodeGraphLayoutCanvasMode() !== "edit") {
      return;
    }
    const sw = Math.max(1, stage.clientWidth || 1);
    const sh = Math.max(1, stage.clientHeight || 1);
    const dx = (event.clientX - drag.startX) / sw;
    const dy = (event.clientY - drag.startY) / sh;
    let { x, y, w, h } = drag.origin;
    if (drag.kind === "move") {
      x += dx;
      y += dy;
    } else if (drag.kind === "resize") {
      const c = drag.corner;
      if (c.includes("e")) {
        w += dx;
      }
      if (c.includes("s")) {
        h += dy;
      }
      if (c.includes("w")) {
        x += dx;
        w -= dx;
      }
      if (c.includes("n")) {
        y += dy;
        h -= dy;
      }
    }
    const rect = nodeGraphLayoutCanvasNormalizeRect({ x, y, w, h, z: drag.origin.z, blend: drag.origin.blend }, drag.origin.z);
    nodeGraphLayoutCanvasApplyTileRect(drag.tile, rect, stage);
    drag.live = rect;
  };

  const onUp = () => {
    if (!drag) {
      return;
    }
    if (drag.live) {
      nodeGraphLayoutCanvasWriteRect(drag.nodeId, drag.live);
    }
    drag.tile.classList.remove("is-dragging");
    drag = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };

  stage.addEventListener("pointerdown", (event) => {
    if (nodeGraphLayoutCanvasMode() !== "edit") {
      return;
    }
    const grip = event.target?.closest?.(".node-layout-canvas-grip");
    const frame = event.target?.closest?.(".node-layout-canvas-frame");
    const tile = event.target?.closest?.(".node-layout-canvas-tile");
    if (!tile || (!grip && !frame)) {
      return;
    }
    // Don't steal clicks from the live face widgets.
    if (event.target?.closest?.(".node-layout-canvas-face") && !grip && !frame) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const nodeId = String(tile.dataset.node || "");
    // Pressing a tile makes it the Arrange target (selection); it never restacks.
    if (event.button === 0 && typeof ensureNodeGraphModuleSelectedForContext === "function") {
      ensureNodeGraphModuleSelectedForContext(nodeId, event);
      nodeGraphLayoutCanvasSyncArrangeBar();
    }
    // Stack index and blend come from the stored pin, not the tile's CSS.
    const pin = nodeGraphLayoutCanvasElementForNode(nodeId);
    const origin = nodeGraphLayoutCanvasNormalizeRect({
      x: tile.dataset.canvasX,
      y: tile.dataset.canvasY,
      w: tile.dataset.canvasW,
      h: tile.dataset.canvasH,
      z: pin?.z,
      blend: pin?.blend,
    });
    drag = {
      tile,
      nodeId,
      kind: grip ? "resize" : "move",
      corner: grip?.dataset?.corner || "",
      startX: event.clientX,
      startY: event.clientY,
      origin,
      live: null,
    };
    tile.classList.add("is-dragging");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });

  // Arrange: right-click a tile opens that display's Display Settings. Capture
  // phase so the tile frame (which covers the face while arranging) does not
  // fall through to the scene menu. Canvas (perform) right-click is unchanged.
  stage.addEventListener("contextmenu", (event) => {
    if (nodeGraphLayoutCanvasMode() !== "edit" || document.body.classList.contains("node-perform-mode")) {
      return;
    }
    const nodeId = String(event.target?.closest?.(".node-layout-canvas-tile")?.dataset?.node || "").trim();
    if (!nodeId || typeof openNodeGraphTraceDisplaySettings !== "function") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (typeof ensureNodeGraphModuleSelectedForContext === "function") {
      ensureNodeGraphModuleSelectedForContext(nodeId, event);
    }
    nodeGraphLayoutCanvasSyncArrangeBar();
    openNodeGraphTraceDisplaySettings(nodeId, event);
  }, true);

  window.addEventListener("resize", () => {
    // Defer: F11 browser fullscreen often only fires resize (no fullscreenchange).
    nodeGraphLayoutCanvasHandleViewportChange({ rebuild: false, defer: true });
  });
}

/**
 * Viewport changed (window resize or browser F11 fullscreen).
 * Light path re-applies freeform tile rects; rebuild path matches F-cycle recycle
 * (nodeGraphLayoutCanvasRefreshOpenStage) so enter/exit fullscreen does not leave
 * a shuffled canvas (B-076).
 */
function nodeGraphLayoutCanvasHandleViewportChange(options = {}) {
  if (nodeGraphLayoutCanvasMode() === "off") {
    return;
  }
  const rebuild = options.rebuild === true;
  const run = () => {
    if (rebuild) {
      nodeGraphLayoutCanvasRefreshOpenStage();
      return;
    }
    if (!(document.getElementById("nodeScreenSoloStage") instanceof HTMLElement)) {
      return;
    }
    nodeGraphLayoutCanvasReapplyTileRects();
    if (typeof nodeGraphScreenSoloRefreshPaint === "function") {
      nodeGraphScreenSoloRefreshPaint();
    }
  };
  if (options.defer) {
    // F11: wait until the browser has applied the new viewport size.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(run);
    });
    return;
  }
  run();
}

function handleNodeGraphLayoutCanvasFullscreenChange() {
  nodeGraphLayoutCanvasHandleViewportChange({ rebuild: true, defer: true });
}

function bindNodeGraphLayoutCanvasSettingsControl() {
  for (const [inputId, wholeModule] of Object.entries(NODE_GRAPH_LAYOUT_CANVAS_PIN_INPUTS)) {
    bindNodeGraphLayoutCanvasPinInput(document.getElementById(inputId), wholeModule);
  }
}

function bindNodeGraphLayoutCanvasPinInput(input, wholeModule) {
  if (!(input instanceof HTMLInputElement) || input.dataset.bound === "true") {
    return;
  }
  input.dataset.bound = "true";
  input.addEventListener("change", (event) => {
    // Not a display-settings field. Do not let the popover change listener
    // treat this as a full-form edit (B-085).
    event.stopPropagation();
    const ids = nodeGraphLayoutCanvasSelectionIds();
    if (!ids.length) {
      input.checked = false;
      return;
    }
    const pinned = input.checked;
    ids.forEach((id, index) => {
      nodeGraphLayoutCanvasSetPinned(id, pinned, {
        persist: false,
        refresh: index === ids.length - 1,
        wholeModule,
      });
    });
    syncNodeGraphLayoutCanvasSettingsControl();
    if (typeof markNodeGraphPatchDirty === "function") {
      markNodeGraphPatchDirty();
    }
    if (typeof setNodeInteractionHelp === "function") {
      setNodeInteractionHelp(
        input.checked
          ? `${NODE_GRAPH_SHOW_IN_PERFORMANCE_VIEW_LABEL} on. F = Canvas, F again = Arrange, F again = exit.`
          : "Removed from the Canvas.",
      );
    }
  });
}

function bindNodeGraphLayoutCanvasEvents() {
  if (document.documentElement.dataset.layoutCanvasBound === "true") {
    return;
  }
  document.documentElement.dataset.layoutCanvasBound = "true";
  document.addEventListener("fullscreenchange", handleNodeGraphLayoutCanvasFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleNodeGraphLayoutCanvasFullscreenChange);
  bindNodeGraphLayoutCanvasSettingsControl();
  document.addEventListener("nodegraph-selection-changed", () => {
    syncNodeGraphLayoutCanvasSettingsControl();
  });
  const popover = document.getElementById("nodeTraceDisplaySettingsPopover");
  if (popover) {
    const obs = new MutationObserver(() => {
      if (!popover.hidden) {
        bindNodeGraphLayoutCanvasSettingsControl();
        syncNodeGraphLayoutCanvasSettingsControl();
      }
    });
    obs.observe(popover, { attributes: true, attributeFilter: ["hidden"] });
  }
  const stage = document.getElementById("nodeScreenSoloStage");
  if (stage) {
    nodeGraphLayoutCanvasBindTileInteractions(stage);
  }
}
