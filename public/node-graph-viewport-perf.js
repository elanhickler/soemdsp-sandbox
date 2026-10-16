// Viewport (zoom/pan) performance: light CSS every event, heavy chrome
// (wires / heatmap / scopes) coalesced to rAF; full fidelity + settings
// persist after the gesture settles.
// Camera: world-layer translate3d+scale; wire SVGs are screen-space
// (camera viewBox on workspace siblings — not CSS-scaled). Mid-gesture
// cull keeps off-screen modules asleep. Scopes on visible modules keep drawing.

// Pan offsets are registered NON-inherited. As plain custom properties on the
// workspace they inherited into ~2.5k module elements, so every pan event
// restyled the whole graph (~370 ms/s of UpdateLayoutTree mid-pan). Only the
// world layers' transform reads them, so they are also written onto those
// layers directly (nodeGraphApplyPanVarsToWorldLayers).
(function registerNodeGraphPanProperties() {
  if (typeof CSS === "undefined" || typeof CSS.registerProperty !== "function") {
    return;
  }
  for (const name of ["--node-graph-pan-x", "--node-graph-pan-y"]) {
    try {
      CSS.registerProperty({ name, syntax: "<length>", inherits: false, initialValue: "0px" });
    } catch (_error) {
      // Already registered (hot reload) or unsupported: plain inheritance.
    }
  }
}());

let nodeGraphWorldLayerCollection = null;

function nodeGraphApplyPanVarsToWorldLayers(workspace, x, y) {
  if (!workspace) {
    return;
  }
  if (!nodeGraphWorldLayerCollection || nodeGraphWorldLayerCollection.owner !== workspace) {
    nodeGraphWorldLayerCollection = {
      owner: workspace,
      layers: workspace.getElementsByClassName("node-graph-world-layer"),
    };
  }
  const layers = nodeGraphWorldLayerCollection.layers;
  // Camera transform inline on the world layers (same value as the stylesheet
  // rule). It reads the live zoom, so mid-gesture zoom never has to touch the
  // inherited --node-graph-zoom (that restyled ~2.9k elements, ~27 ms a step).
  const zoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : (nodeGraphMvp?.zoom || 1);
  const transform = `translate3d(${x}, ${y}, 0) scale(${zoom})`;
  for (let i = 0; i < layers.length; i += 1) {
    layers[i].style.setProperty("--node-graph-pan-x", x);
    layers[i].style.setProperty("--node-graph-pan-y", y);
    if (layers[i].style.transform !== transform) {
      layers[i].style.transform = transform;
    }
  }
}

// FIX C (trial, easy revert: set false or delete this block + its 2 calls).
// will-change: transform on the world layers only while a pan/zoom gesture is
// active: Chrome keeps the layer's raster scale instead of re-rastering every
// step (stays soft/blocky mid-gesture). Dropped on settle -> crisp re-raster.
const NODE_GRAPH_GESTURE_WILL_CHANGE = true;

function nodeGraphSetWorldLayerWillChange(workspace, on) {
  if (!NODE_GRAPH_GESTURE_WILL_CHANGE || !workspace?.getElementsByClassName) {
    return;
  }
  const layers = workspace.getElementsByClassName("node-graph-world-layer");
  for (let i = 0; i < layers.length; i += 1) {
    if (on) {
      layers[i].style.willChange = "transform";
    } else {
      layers[i].style.removeProperty("will-change");
    }
  }
}

// Gesture display hold (easy revert: set false). While a pan/zoom gesture is
// active, scope frames and face pumps skip painting, so the world layer moves
// as a cached GPU layer with no canvas updates; settle repaints everything
// (flushNodeGraphViewportHeavyChrome -> scheduleNodeGraphModuleScopeDraw).
// Trade-off: live displays freeze for the duration of the gesture.
const NODE_GRAPH_GESTURE_HOLD_DISPLAYS = true;

function nodeGraphViewportHoldsDisplays() {
  return NODE_GRAPH_GESTURE_HOLD_DISPLAYS && nodeGraphViewportGestureActive();
}

/**
 * Inherited zoom var (module stroke compensate, grid size read it). Written
 * only outside gestures / on settle: one restyle per gesture, not per step.
 */
function nodeGraphWriteInheritedZoomVar(workspace) {
  const el = workspace || document.getElementById("nodeGraphWorkspace");
  if (!el?.style) {
    return;
  }
  const zoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : (nodeGraphMvp?.zoom || 1);
  const value = String(zoom);
  if (el.style.getPropertyValue("--node-graph-zoom") !== value) {
    el.style.setProperty("--node-graph-zoom", value);
  }
}

const nodeGraphViewportPerf = {
  heavyRaf: 0,
  settleTimer: 0,
  persistTimer: 0,
  wheelActiveUntil: 0,
  lastWirePlanKey: "",
  lastWirePlan: null,
  settleMs: 140,
  persistMs: 220,
  wheelHoldMs: 160,
};

function nodeGraphViewportWheelActive() {
  return (performance.now?.() || Date.now()) < (nodeGraphViewportPerf.wheelActiveUntil || 0);
}

function nodeGraphViewportGestureActive() {
  return Boolean(
    nodeGraphMvp?.workspacePanning
    || nodeGraphMvp?.smoothZoomDragging
    || nodeGraphMvp?.workspacePinchZooming
    || nodeGraphViewportWheelActive(),
  );
}

/** Zoom-ish gesture kinds: hide wires + port jacks while active (CSS). */
function nodeGraphViewportGestureIsZoom(kind = "") {
  const k = String(kind || "").toLowerCase();
  return k === "zoom" || k === "wheel" || k === "pinch" || k === "smooth-zoom" || k === "smoothzoom";
}

/** Mark an interactive viewport gesture (wheel / pan / pinch / smooth-zoom). */
function markNodeGraphViewportGesture(kind = "gesture") {
  nodeGraphViewportPerf.lastGestureKind = String(kind || "gesture");
  // Bumped on every pan/zoom event: per-gesture client-rect caches key on it.
  nodeGraphViewportPerf.viewEpoch = (nodeGraphViewportPerf.viewEpoch || 0) + 1;
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) {
    return;
  }
  const wasGesturing = workspace.classList.contains("viewport-gesturing");
  workspace.classList.add("viewport-gesturing");
  if (!wasGesturing) {
    nodeGraphSetWorldLayerWillChange(workspace, true);
  }
  // Gesture start: seed workspace layout metrics once (left/top/size) so wheel
  // zoom anchors avoid getBoundingClientRect every tick. ResizeObserver + settle
  // invalidate; mid-gesture samples reuse the cache.
  if (!wasGesturing) {
    if (typeof nodeGraphMvp === "object" && nodeGraphMvp && !nodeGraphMvp._workspaceLayoutMetrics) {
      if (typeof nodeGraphWorkspaceLayoutMetrics === "function") {
        nodeGraphWorkspaceLayoutMetrics(workspace);
      }
    }
    // Cancel any pending mid-gesture heatmap phase; settle restores full chrome.
    if (nodeGraphViewportPerf.gestureHeatmapRaf) {
      window.cancelAnimationFrame(nodeGraphViewportPerf.gestureHeatmapRaf);
      nodeGraphViewportPerf.gestureHeatmapRaf = 0;
    }
  }
  // Hide wires + inlets/outlets + connection dots while zooming (not pan).
  const zooming = nodeGraphViewportGestureIsZoom(kind)
    || nodeGraphMvp?.smoothZoomDragging
    || nodeGraphMvp?.workspacePinchZooming;
  if (zooming) {
    const wasZooming = workspace.classList.contains("viewport-zooming");
    workspace.classList.add("viewport-zooming");
    // Freeze stroke-zoom-compensate once per zoom gesture so outline widths
    // do not cascade on every --node-graph-zoom tick (costly at 10–20×).
    if (!wasZooming) {
      freezeNodeGraphViewportStrokeCompensate(workspace);
    }
  }
  // Pan / drag-zoom: lights + wires stay frozen until pointerup (no settle timer
  // mid-drag). Wheel has no mouse-up, so only wheel schedules a settle.
  // Kind "zoom" (programmatic / mis-tagged) must also settle — otherwise
  // viewport-zooming sticks and jacks never come back.
  if (kind === "wheel" || kind === "zoom") {
    nodeGraphViewportPerf.wheelActiveUntil = (performance.now?.() || Date.now())
      + nodeGraphViewportPerf.wheelHoldMs;
    scheduleNodeGraphViewportSettle();
  }
}

/** Snapshot 1/zoom into a frozen CSS var; viewport-zooming uses it mid-gesture. */
function freezeNodeGraphViewportStrokeCompensate(workspace) {
  const el = workspace || document.getElementById("nodeGraphWorkspace");
  if (!el?.style) {
    return;
  }
  if (el.style.getPropertyValue("--node-module-stroke-zoom-compensate-frozen")) {
    return;
  }
  const z = typeof nodeGraphZoom === "function"
    ? nodeGraphZoom()
    : (nodeGraphMvp?.zoom || 1);
  const compensate = 1 / Math.max(0.0001, Number(z) || 1);
  el.style.setProperty("--node-module-stroke-zoom-compensate-frozen", String(compensate));
}

function unfreezeNodeGraphViewportStrokeCompensate(workspace) {
  const el = workspace || document.getElementById("nodeGraphWorkspace");
  if (!el?.style) {
    return;
  }
  el.style.removeProperty("--node-module-stroke-zoom-compensate-frozen");
}

/**
 * Pointer-up end of pan / pinch / smooth-zoom: one full lights+wires pass.
 * No debounce timer — user asked for mouse-up only.
 */
function flushNodeGraphViewportOnPointerUp(options = {}) {
  if (nodeGraphViewportPerf.heavyRaf) {
    window.cancelAnimationFrame(nodeGraphViewportPerf.heavyRaf);
    nodeGraphViewportPerf.heavyRaf = 0;
  }
  if (nodeGraphViewportPerf.settleTimer) {
    window.clearTimeout(nodeGraphViewportPerf.settleTimer);
    nodeGraphViewportPerf.settleTimer = 0;
  }
  nodeGraphViewportPerf.wheelActiveUntil = 0;
  clearNodeGraphViewportGestureClass();
  if (typeof applyNodeGraphViewportCssLight === "function") {
    applyNodeGraphViewportCssLight({
      zoom: options.zoom !== false,
      pan: options.pan !== false,
    });
  }
  if (typeof syncNodeGraphWorldPositionReadout === "function") {
    syncNodeGraphWorldPositionReadout();
  }
  if (typeof scheduleNodeGraphViewportCullRefresh === "function") {
    scheduleNodeGraphViewportCullRefresh();
  }
  flushNodeGraphViewportHeavyChrome({ full: true });
  if (options.persist !== false) {
    scheduleNodeGraphWorkspaceViewPersist();
  }
}

function clearNodeGraphViewportGestureClass() {
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) {
    return;
  }
  // Settle: catch the inherited zoom var up once, then drop the frozen stroke.
  nodeGraphWriteInheritedZoomVar(workspace);
  workspace.classList.remove("viewport-gesturing", "viewport-zooming");
  nodeGraphSetWorldLayerWillChange(workspace, false);
  unfreezeNodeGraphViewportStrokeCompensate(workspace);
  if (typeof invalidateNodeGraphWorkspaceLayoutMetrics === "function") {
    invalidateNodeGraphWorkspaceLayoutMetrics();
  }
}

if (typeof window !== "undefined" && !window.__nodeGraphViewportStrokeRescue) {
  window.__nodeGraphViewportStrokeRescue = true;
  window.addEventListener("pageshow", () => {
    if (typeof nodeGraphViewportGestureActive === "function" && nodeGraphViewportGestureActive()) {
      return;
    }
    clearNodeGraphViewportGestureClass();
  });
  document.addEventListener("pointerdown", () => {
    if (typeof nodeGraphViewportGestureActive === "function" && nodeGraphViewportGestureActive()) {
      return;
    }
    const workspace = document.getElementById("nodeGraphWorkspace");
    if (workspace?.classList.contains("viewport-zooming")) {
      clearNodeGraphViewportGestureClass();
    }
  }, true);
}

/**
 * Light path only: CSS zoom/pan vars + cheap chrome (buttons, world readout).
 * Safe to call every wheel/pointermove sample.
 */
function applyNodeGraphViewportCssLight(options = {}) {
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) {
    return;
  }
  const cameraGesturing = typeof nodeGraphViewportGestureActive === "function"
    && nodeGraphViewportGestureActive();
  if (options.zoom !== false) {
    const zoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : (nodeGraphMvp?.zoom || 1);
    // Mid-gesture: world-layer transform only (below). Settle writes the var.
    if (!cameraGesturing) {
      nodeGraphWriteInheritedZoomVar(workspace);
    }
    workspace.dataset.zoom = Number(zoom).toFixed(2);
    workspace.classList.toggle("pixelated-canvas-zoom", zoom > 2.5);
  }
  if (options.zoom !== false || options.pan !== false) {
    const pan = nodeGraphMvp.pan || { x: 0, y: 0 };
    const originOffset = typeof nodeGraphRenderedOriginOffset === "function"
      ? nodeGraphRenderedOriginOffset(pan, workspace)
      : pan;
    nodeGraphApplyPanVarsToWorldLayers(workspace, `${originOffset.x}px`, `${originOffset.y}px`);
  }
  if (options.pan !== false) {
    const pan = nodeGraphMvp.pan || { x: 0, y: 0 };
    const originOffset = typeof nodeGraphRenderedOriginOffset === "function"
      ? nodeGraphRenderedOriginOffset(pan, workspace)
      : pan;
    workspace.style.setProperty("--node-graph-pan-x", `${originOffset.x}px`);
    workspace.style.setProperty("--node-graph-pan-y", `${originOffset.y}px`);
    workspace.dataset.panX = String(pan.x);
    workspace.dataset.panY = String(pan.y);
    // Scope screen-items convert layout->screen from this (no gBCR on paint).
    if (typeof nodeGraphMvp === "object" && nodeGraphMvp) {
      nodeGraphMvp._cameraScreenOrigin = {
        x: nodeGraphFiniteNumber(originOffset.x),
        y: nodeGraphFiniteNumber(originOffset.y),
      };
    }
  }
  // Screen-space wires: cheap viewBox update keeps cables glued during pan
  // without rebuilding paths (paths stay in world coords).
  if (
    (options.zoom !== false || options.pan !== false)
    && typeof syncNodeGraphWireSvgViewBox === "function"
  ) {
    // Mid-gesture: once per animation frame. The sync also re-presents the GL
    // cable/grid canvases (two full batches + a layout read); per pointermove
    // that ran 8-16x a frame on high-rate mice. rAF runs before this frame's
    // paint, so cables stay glued to the world-layer transform.
    if (cameraGesturing) {
      if (!nodeGraphViewportPerf.wireViewBoxRaf) {
        nodeGraphViewportPerf.wireViewBoxRaf = window.requestAnimationFrame(() => {
          nodeGraphViewportPerf.wireViewBoxRaf = 0;
          syncNodeGraphWireSvgViewBox();
        });
      }
    } else {
      if (nodeGraphViewportPerf.wireViewBoxRaf) {
        window.cancelAnimationFrame(nodeGraphViewportPerf.wireViewBoxRaf);
        nodeGraphViewportPerf.wireViewBoxRaf = 0;
      }
      syncNodeGraphWireSvgViewBox();
    }
  }
  if (options.zoomButtons !== false && options.zoom !== false) {
    const zoomOutButton = document.getElementById("nodeZoomOutButton");
    const zoomResetButton = document.getElementById("nodeZoomResetButton");
    const zoomInButton = document.getElementById("nodeZoomInButton");
    const z = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1;
    const limits = typeof nodeGraphZoomLimits !== "undefined" ? nodeGraphZoomLimits : { min: 0.1, max: 100 };
    if (zoomOutButton) {
      zoomOutButton.disabled = z <= limits.min + 0.001;
    }
    if (zoomInButton) {
      zoomInButton.disabled = z >= limits.max - 0.001;
    }
    if (zoomResetButton && zoomResetButton.dataset.editingZoom !== "true") {
      const zoomLabel = typeof nodeGraphZoomLabel === "function" ? nodeGraphZoomLabel() : `${Math.round(z * 100)}%`;
      zoomResetButton.textContent = zoomLabel;
      zoomResetButton.setAttribute("aria-label", `Current zoom ${zoomLabel}. Reset graph zoom to 1:1`);
      zoomResetButton.removeAttribute("title");
    }
  }
  const gesturing = typeof nodeGraphViewportGestureActive === "function"
    && nodeGraphViewportGestureActive();
  // Mid-pan/zoom: CSS vars only. Readouts / heatmap / cull force layout and
  // were dropping pan to ~1fps even with scopes frozen.
  if (!gesturing && options.readouts !== false) {
    if (typeof syncNodeGraphWorldPositionReadout === "function") {
      syncNodeGraphWorldPositionReadout();
    }
    if (typeof syncNodeGraphOriginMarker === "function") {
      syncNodeGraphOriginMarker();
    }
  }
  if (
    typeof scheduleNodeGraphRoomDimmerDraw === "function"
    && !gesturing
  ) {
    scheduleNodeGraphRoomDimmerDraw();
  }
  if (!gesturing && typeof updateNodeGraphGridHeatmap === "function") {
    updateNodeGraphGridHeatmap({ lite: true });
  }
  // Mid-gesture: skip heatmap phase updates (esp. costly at high zoom).
  // Settle / pointer-up restores via flushNodeGraphViewportHeavyChrome.
  // Cull must keep running while zoomed-in pan: otherwise modules that leave
  // the view stay awake (display:block) and the composited layer keeps growing
  // → "I'm zoomed in and pan is laggy for no reason." Use cached sizes only.
  scheduleNodeGraphViewportCullRefresh({
    cacheSizesOnly: gesturing,
    minIntervalMs: gesturing ? 48 : 0,
  });
}

function nodeGraphWirePlanCacheKey() {
  const nodes = nodeGraphMvp?.patch?.nodes;
  const n = Array.isArray(nodes) ? nodes.length : 0;
  const c = nodeGraphMvp?.connections?.length || 0;
  const m = nodeGraphMvp?.modulations?.length || 0;
  const g = nodeGraphMvp?.graphConnections?.length || 0;
  // Order / bypass can change feedback highlighting without connection counts.
  const orderLen = nodeGraphMvp?.live?.planEvidence?.order?.length
    ?? nodeGraphMvp?.executionPlan?.order?.length
    ?? 0;
  return `${n}|${c}|${m}|${g}|${orderLen}`;
}

function nodeGraphViewportCompileWirePlan() {
  const key = nodeGraphWirePlanCacheKey();
  if (
    nodeGraphViewportPerf.lastWirePlan
    && nodeGraphViewportPerf.lastWirePlanKey === key
  ) {
    return nodeGraphViewportPerf.lastWirePlan;
  }
  const plan = typeof compileNodeGraphExecutionPlan === "function"
    ? compileNodeGraphExecutionPlan()
    : null;
  nodeGraphViewportPerf.lastWirePlanKey = key;
  nodeGraphViewportPerf.lastWirePlan = plan;
  return plan;
}

/** Invalidate wire plan cache (call after patch/wire edits). */
function invalidateNodeGraphViewportWirePlanCache() {
  nodeGraphViewportPerf.lastWirePlan = null;
  nodeGraphViewportPerf.lastWirePlanKey = "";
}

/**
 * Heavy chrome: wires + module lights (heatmap).
 * During pan/zoom the surface is CSS-transformed — do not redraw lights or
 * wires mid-gesture. full:true only (pointer-up / wheel settle / immediate).
 */
function flushNodeGraphViewportHeavyChrome(options = {}) {
  const gesturing = nodeGraphViewportGestureActive();
  if (typeof scheduleNodeGraphRoomDimmerDraw === "function") {
    scheduleNodeGraphRoomDimmerDraw();
  }
  const full = options.full === true || !gesturing;
  if (typeof updateNodeGraphGridHeatmap === "function") {
    updateNodeGraphGridHeatmap({ lite: !full });
  }
  if (!full) {
    // Pause module lights / wires mid-gesture. Grid position already updated.
    return;
  }
  // Camera/layout settle is a geometry owner — republish attaches before wires.
  if (typeof nodeGraphModuleGeometryInvalidateAll === "function") {
    nodeGraphModuleGeometryInvalidateAll();
  }
  if (typeof nodeGraphModuleGeometryPublishVisible === "function") {
    nodeGraphModuleGeometryPublishVisible();
  }
  if (typeof drawNodeGraphWires === "function") {
    drawNodeGraphWires({
      lite: false,
      skipHeatmap: true,
      skipScopes: false,
      skipSelection: false,
    });
  }
  if (typeof scheduleNodeGraphModuleScopeDraw === "function") {
    scheduleNodeGraphModuleScopeDraw();
  }
  if (typeof scheduleNodeGraphModuleFramesUpdate === "function") {
    scheduleNodeGraphModuleFramesUpdate({ force: false });
  }
}

function scheduleNodeGraphViewportHeavyChrome() {
  // Kept for call sites. Never rebuild lights/wires while a gesture is active.
  if (nodeGraphViewportPerf.heavyRaf) {
    return;
  }
  nodeGraphViewportPerf.heavyRaf = window.requestAnimationFrame(() => {
    nodeGraphViewportPerf.heavyRaf = 0;
    if (nodeGraphViewportGestureActive()) {
      return;
    }
    flushNodeGraphViewportHeavyChrome({ full: true });
  });
}

function scheduleNodeGraphViewportSettle() {
  if (nodeGraphViewportPerf.settleTimer) {
    window.clearTimeout(nodeGraphViewportPerf.settleTimer);
  }
  nodeGraphViewportPerf.settleTimer = window.setTimeout(() => {
    nodeGraphViewportPerf.settleTimer = 0;
    nodeGraphViewportPerf.wheelActiveUntil = 0;
    // Drops viewport-zooming + unfreezes stroke compensate; then full chrome.
    clearNodeGraphViewportGestureClass();
    flushNodeGraphViewportHeavyChrome({ full: true });
    // Persist after settle so wheel doesn't thrash localStorage.
    scheduleNodeGraphWorkspaceViewPersist();
  }, nodeGraphViewportPerf.settleMs);
}

function scheduleNodeGraphWorkspaceViewPersist() {
  if (typeof saveNodeGraphWorkspaceViewToUserSettings !== "function") {
    return;
  }
  if (nodeGraphViewportPerf.persistTimer) {
    window.clearTimeout(nodeGraphViewportPerf.persistTimer);
  }
  nodeGraphViewportPerf.persistTimer = window.setTimeout(() => {
    nodeGraphViewportPerf.persistTimer = 0;
    saveNodeGraphWorkspaceViewToUserSettings({ status: false });
  }, nodeGraphViewportPerf.persistMs);
}

/** Immediate full chrome (no gesture). Use after reset / auto-frame. */
const nodeGraphViewportCull = {
  observer: null,
};

// Live HTMLCollections: the browser keeps them current, and in the modular
// view they are empty, so the per-face "is it presented?" check is O(1)
// instead of a document-wide querySelector every paint.
let nodeGraphPresentedFaceCollections = null;

function nodeGraphPresentedDisplayFace(nodeId) {
  const id = String(nodeId || "").trim();
  if (!id || typeof document === "undefined") {
    return null;
  }
  // Every presented face carries node-screen-solo-face (layout canvas,
  // screen solo and metamodule mirror all add it), so one live collection
  // covers all three; walking three made three document walks per frame.
  if (!nodeGraphPresentedFaceCollections) {
    nodeGraphPresentedFaceCollections = document.getElementsByClassName("node-screen-solo-face");
  }
  // id -> first presented face (same order as the old collection walk),
  // built once per animation frame. Live-collection .length re-walks the
  // document after any DOM write, and every face pump is its own rAF
  // callback, so a per-call (or per-task) walk ran dozens of times a frame.
  // Hits are re-validated on use; a face presented between frames is seen
  // from the next frame on.
  const frameStamp = nodeGraphViewportFrameStamp();
  let map = nodeGraphPresentedFaceMap;
  if (map && (frameStamp === null || map.frameStamp !== frameStamp)) {
    map = null;
  }
  if (!map) {
    map = { faces: new Map(), frameStamp };
    const collection = nodeGraphPresentedFaceCollections;
    const count = collection.length;
    // Old lookup order: layout-canvas faces first, then solo, then metamodule
    // (metamodule faces are also layout faces).
    for (let pass = 0; pass < 2 && count > 0; pass += 1) {
      for (let i = 0; i < count; i += 1) {
        const element = collection[i];
        if (pass === 0 && !element.classList.contains("node-layout-canvas-face")) continue;
        const faceId = element.dataset.node;
        if (faceId && !map.faces.has(faceId)) {
          map.faces.set(faceId, element);
        }
      }
    }
    nodeGraphPresentedFaceMap = map;
    if (frameStamp === null && typeof queueMicrotask === "function") {
      queueMicrotask(() => {
        nodeGraphPresentedFaceMap = null;
      });
    }
  }
  const hit = map.faces.get(id) || null;
  if (hit && (!hit.isConnected || hit.dataset.node !== id)) {
    nodeGraphPresentedFaceMap = null;
    return nodeGraphPresentedDisplayFace(id);
  }
  return hit;
}

let nodeGraphPresentedFaceMap = null;

/** Same value for every rAF callback of one frame (null when unavailable). */
function nodeGraphViewportFrameStamp() {
  const t = typeof document !== "undefined" ? document.timeline?.currentTime : null;
  return Number.isFinite(t) ? t : null;
}

/**
 * Cached `${selector}[data-node="id"]` lookup for per-frame paint paths.
 * A hit is reused while it stays connected and still carries that node id;
 * otherwise one fresh querySelector refills it.
 */
const nodeGraphNodeElementLookupCache = new Map();

function nodeGraphCachedNodeElement(selector, nodeId) {
  const id = String(nodeId || "");
  if (!id || typeof document === "undefined") {
    return null;
  }
  let bySelector = nodeGraphNodeElementLookupCache.get(selector);
  if (!bySelector) {
    bySelector = new Map();
    nodeGraphNodeElementLookupCache.set(selector, bySelector);
  }
  const hit = bySelector.get(id);
  if (hit && hit.isConnected && hit.dataset.node === id) {
    return hit;
  }
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, "");
  const element = document.querySelector(`${selector}[data-node="${escaped}"]`);
  if (element) {
    bySelector.set(id, element);
  } else {
    bySelector.delete(id);
  }
  return element;
}

/** Cached child lookup under a mounted element (paint paths). */
const nodeGraphChildLookupCache = new WeakMap();

function nodeGraphCachedChild(parent, selector) {
  if (!parent?.querySelector) {
    return null;
  }
  let bySelector = nodeGraphChildLookupCache.get(parent);
  if (!bySelector) {
    bySelector = new Map();
    nodeGraphChildLookupCache.set(parent, bySelector);
  }
  const hit = bySelector.get(selector);
  if (hit && hit.isConnected && parent.contains(hit)) {
    return hit;
  }
  const element = parent.querySelector(selector);
  if (element) {
    bySelector.set(selector, element);
  } else {
    bySelector.delete(selector);
  }
  return element;
}

function nodeGraphDisplayIsPresented(nodeId) {
  return Boolean(nodeGraphPresentedDisplayFace(nodeId));
}

function nodeGraphModuleIsViewportAsleep(nodeOrElement) {
  const element = nodeOrElement instanceof Element
    ? (nodeOrElement.classList.contains("dsp-node")
      ? nodeOrElement
      : nodeOrElement.closest?.(".dsp-node"))
    : (typeof nodeGraphCachedNodeElement === "function"
      ? nodeGraphCachedNodeElement(".dsp-node", nodeOrElement)
      : (typeof nodeGraphNodeElement === "function"
        ? nodeGraphNodeElement(nodeOrElement)
        : null));
  const nodeId = String(element?.dataset?.node || nodeOrElement || "").trim();
  if (nodeId && nodeGraphDisplayIsPresented(nodeId)) {
    return false;
  }
  return Boolean(element?.classList.contains("viewport-asleep"));
}

/** Bands CSS skips with content-visibility:hidden on .viewport-asleep. */
var NODE_GRAPH_VIEWPORT_ASLEEP_SKIP_SEL = [
  ".node-module-face",
  ".node-module-scope-window",
  ".node-solid-module-custom-ui",
].join(", ");

/**
 * True when measuring this node would force-render a content-visibility:hidden
 * band (Chrome: "Rendering was performed in a subtree hidden by content-visibility").
 * Asleep modules use display:none (whole node). Jack census skips them.
 */
function nodeGraphElementInSkippedContentVisibility(element) {
  if (!element?.closest) {
    return false;
  }
  const module = element.closest(".dsp-node");
  if (!module?.classList?.contains("viewport-asleep")) {
    return false;
  }
  return Boolean(element.closest(NODE_GRAPH_VIEWPORT_ASLEEP_SKIP_SEL));
}

/**
 * CSS box without forcing a content-visibility:hidden subtree to paint.
 * Asleep faces reuse the last awake size (or fallback).
 */
function nodeGraphElementClientSize(element, fallbackW = 1, fallbackH = 1) {
  const fw = Math.max(1, nodeGraphFiniteNumber(fallbackW, 1));
  const fh = Math.max(1, nodeGraphFiniteNumber(fallbackH, 1));
  if (!element) {
    return { width: fw, height: fh, skipped: true };
  }
  if (nodeGraphElementInSkippedContentVisibility(element)) {
    const lastW = Number(element._awakeClientWidth);
    const lastH = Number(element._awakeClientHeight);
    return {
      width: Math.max(1, lastW > 0 ? lastW : fw),
      height: Math.max(1, lastH > 0 ? lastH : fh),
      skipped: true,
    };
  }
  const width = Math.max(1, Math.floor(nodeGraphFiniteNumber(element.clientWidth, fw)));
  const height = Math.max(1, Math.floor(nodeGraphFiniteNumber(element.clientHeight, fh)));
  element._awakeClientWidth = width;
  element._awakeClientHeight = height;
  return { width, height, skipped: false };
}

function nodeGraphViewportCullPainterRoots(element) {
  const roots = [];
  if (element) {
    roots.push(element);
  }
  const nodeId = String(element?.dataset?.node || "");
  const presented = nodeId ? nodeGraphPresentedDisplayFace(nodeId) : null;
  if (presented && !roots.some((root) => root === presented || root.contains?.(presented))) {
    roots.push(presented);
  }
  return roots;
}

function nodeGraphViewportCullWakePainters(element) {
  if (!element) {
    return;
  }
  const nodeId = String(element.dataset?.node || "");
  const roots = nodeGraphViewportCullPainterRoots(element);
  for (const root of roots) {
    for (const face of root.querySelectorAll?.(".node-fbm-field-face") || []) {
      if (typeof nodeGraphFbmFieldStartLoop === "function") {
        nodeGraphFbmFieldStartLoop(face, nodeId || face.dataset?.node);
      }
    }
    if (root.matches?.(".node-fbm-field-face") && typeof nodeGraphFbmFieldStartLoop === "function") {
      nodeGraphFbmFieldStartLoop(root, nodeId);
    }
    for (const face of root.querySelectorAll?.(
      ".node-harmonic-lines-display, .node-harmonic-count-display",
    ) || []) {
      face._startFaceLoop?.();
    }
    for (const face of root.querySelectorAll?.(".node-sample-waveform-display") || []) {
      if (typeof nodeGraphSampleWaveformEnsureLoop === "function") {
        nodeGraphSampleWaveformEnsureLoop(face);
      }
    }
    if (root.matches?.(".node-sample-waveform-display")
      && typeof nodeGraphSampleWaveformEnsureLoop === "function") {
      nodeGraphSampleWaveformEnsureLoop(root);
    }
    if (typeof nodeGraphScreenSoloWakeFace === "function") {
      nodeGraphScreenSoloWakeFace(root.matches?.(".node-module-face, .node-module-scope-window, .node-midi-keyboard-module, .node-arp-keys-face")
        ? root
        : (root.querySelector?.(".node-module-face, .node-module-scope-window, .node-midi-keyboard-module, .node-arp-keys-face") || root));
    }
  }
  if (nodeId && typeof requestNodeGraphModuleScopeRepaint === "function") {
    requestNodeGraphModuleScopeRepaint(nodeId);
  }
  if (typeof scheduleNodeGraphModuleScopeDraw === "function") {
    scheduleNodeGraphModuleScopeDraw({ force: true });
  }
  element.dispatchEvent(new CustomEvent("nodegraphviewport", {
    bubbles: false,
    detail: { asleep: false },
  }));
}

function nodeGraphViewportCullSleepPainters(element) {
  if (!element) {
    return;
  }
  if (typeof nodeGraphViewportCullMustStayAwake === "function"
    && nodeGraphViewportCullMustStayAwake(element)) {
    return;
  }
  for (const face of element.querySelectorAll(".node-fbm-field-face")) {
    if (typeof nodeGraphFbmFieldStopLoop === "function") {
      nodeGraphFbmFieldStopLoop(face);
    }
  }
  for (const face of element.querySelectorAll(
    ".node-harmonic-lines-display, .node-harmonic-count-display",
  )) {
    if (face._raf) {
      window.cancelAnimationFrame(face._raf);
      face._raf = 0;
    }
  }
  for (const face of element.querySelectorAll(".node-sample-waveform-display")) {
    if (typeof nodeGraphSampleWaveformStopLoop === "function") {
      nodeGraphSampleWaveformStopLoop(face);
    }
  }
  element.dispatchEvent(new CustomEvent("nodegraphviewport", {
    bubbles: false,
    detail: { asleep: true },
  }));
}

function nodeGraphViewportCullBootOrLayoutUnsafe() {
  // During boot the shell is visibility:hidden. IntersectionObserver and a
  // zero-sized workspace cull then mark every module viewport-asleep
  // (display:none). After the loading screen fades, K still works (controller
  // dock) but the graph stays black with no nodes. Never sleep while booting
  // or when the workspace has no real layout box yet.
  const body = document.body;
  if (
    body?.classList?.contains("node-boot-loading")
    || body?.classList?.contains("node-boot-fading")
  ) {
    return true;
  }
  return false;
}

/** Module world layer plus Text Box hosts (#nodeGraphAnnotationNodes).
 *  Those nodes sit outside the zoom surface. A cull that only walks the
 *  module world layer never clears viewport-asleep, and display:none
 *  stops IntersectionObserver from firing again. */
function nodeGraphViewportCullModuleRoots(surface) {
  const roots = [];
  const seen = new Set();
  const add = (root) => {
    if (!root || seen.has(root)) {
      return;
    }
    seen.add(root);
    roots.push(root);
  };
  add(surface
    || (typeof nodeGraphZoomSurface === "function"
      ? nodeGraphZoomSurface()
      : document.getElementById("nodeGraphWorldLayer") || document.getElementById("nodeGraphZoomSurface"))
    || document.getElementById("nodeGraphWorkspace"));
  add(document.getElementById("nodeGraphAnnotationNodes"));
  return roots;
}

function nodeGraphViewportCullForEachNode(surface, selector, visit) {
  const seen = new Set();
  for (const root of nodeGraphViewportCullModuleRoots(surface)) {
    for (const element of root.querySelectorAll(selector)) {
      if (seen.has(element)) {
        continue;
      }
      seen.add(element);
      visit(element);
    }
  }
}

function nodeGraphViewportCullWakeAll(surface) {
  nodeGraphViewportCullForEachNode(
    surface,
    ".dsp-node.viewport-asleep, .dsp-node:not(.removed)",
    (element) => {
      nodeGraphViewportCullApply(element, true);
    },
  );
}

function nodeGraphViewportCullRefresh(options = {}) {
  const workspace = document.getElementById("nodeGraphWorkspace");
  const surface = typeof nodeGraphZoomSurface === "function"
    ? nodeGraphZoomSurface()
    : document.getElementById("nodeGraphWorldLayer") || document.getElementById("nodeGraphZoomSurface");
  if (!workspace || !surface) {
    return;
  }
  if (nodeGraphViewportCullBootOrLayoutUnsafe()) {
    nodeGraphViewportCullWakeAll(surface);
    return;
  }
  const zoom = Math.max(
    0.0001,
    typeof nodeGraphZoom === "function" ? nodeGraphZoom() : (nodeGraphFiniteNumber(nodeGraphMvp?.zoom, 1)),
  );
  const origin = typeof nodeGraphRenderedOriginOffset === "function"
    ? nodeGraphRenderedOriginOffset()
    : { x: 0, y: 0 };
  const box = typeof nodeGraphWorkspaceLayoutMetrics === "function"
    ? nodeGraphWorkspaceLayoutMetrics(workspace)
    : { width: workspace.clientWidth, height: workspace.clientHeight };
  const boxW = nodeGraphFiniteNumber(box.width);
  const boxH = nodeGraphFiniteNumber(box.height);
  // Zero/tiny workspace (iframe not laid out yet) would cull the whole patch.
  if (boxW < 32 || boxH < 32) {
    nodeGraphViewportCullWakeAll(surface);
    return;
  }
  const margin = 96;
  const worldLeft = (0 - margin - (nodeGraphFiniteNumber(origin.x))) / zoom;
  const worldTop = (0 - margin - (nodeGraphFiniteNumber(origin.y))) / zoom;
  const worldRight = (boxW + margin - (nodeGraphFiniteNumber(origin.x))) / zoom;
  const worldBottom = (boxH + margin - (nodeGraphFiniteNumber(origin.y))) / zoom;
  const selected = typeof nodeGraphSelectedNodeIds === "function"
    ? nodeGraphSelectedNodeIds()
    : new Set();
  const cacheSizesOnly = Boolean(options.cacheSizesOnly);
  nodeGraphViewportCullForEachNode(surface, ".dsp-node:not(.removed)", (element) => {
    const id = String(element.dataset?.node || "");
    let width = 0;
    let height = 0;
    if (!cacheSizesOnly) {
      width = nodeGraphFiniteNumber(element.offsetWidth);
      height = nodeGraphFiniteNumber(element.offsetHeight);
    }
    if (width > 1 && height > 1) {
      element._viewportCullW = width;
      element._viewportCullH = height;
    } else {
      width = nodeGraphFiniteNumber(element._viewportCullW, 220);
      height = nodeGraphFiniteNumber(element._viewportCullH, 140);
    }
    const x = Number.parseFloat(element.style.getPropertyValue("--node-x")) || 0;
    const y = Number.parseFloat(element.style.getPropertyValue("--node-y")) || 0;
    const intersecting = x < worldRight
      && (x + width) > worldLeft
      && y < worldBottom
      && (y + height) > worldTop;
    nodeGraphViewportCullApply(element, intersecting || (id && selected.has(id)));
  });
}

function scheduleNodeGraphViewportGestureHeatmapPhase() {
  if (nodeGraphViewportPerf.gestureHeatmapRaf) {
    return;
  }
  nodeGraphViewportPerf.gestureHeatmapRaf = window.requestAnimationFrame(() => {
    nodeGraphViewportPerf.gestureHeatmapRaf = 0;
    if (typeof updateNodeGraphGridHeatmap === "function") {
      updateNodeGraphGridHeatmap({ lite: true, phaseOnly: true });
    }
  });
}

function scheduleNodeGraphViewportCullRefresh(options = {}) {
  const cacheSizesOnly = Boolean(options.cacheSizesOnly);
  const minIntervalMs = Math.max(0, nodeGraphFiniteNumber(options.minIntervalMs));
  const now = performance.now?.() || Date.now();
  if (
    minIntervalMs > 0
    && nodeGraphViewportPerf.cullLastAt
    && (now - nodeGraphViewportPerf.cullLastAt) < minIntervalMs
  ) {
    // Still coalesce a trailing refresh so the last pan sample gets culled.
    if (!nodeGraphViewportPerf.cullTrailingTimer) {
      const wait = Math.max(0, minIntervalMs - (now - nodeGraphViewportPerf.cullLastAt));
      nodeGraphViewportPerf.cullTrailingTimer = window.setTimeout(() => {
        nodeGraphViewportPerf.cullTrailingTimer = 0;
        scheduleNodeGraphViewportCullRefresh({
          cacheSizesOnly,
          minIntervalMs: 0,
        });
      }, wait);
    }
    return;
  }
  if (nodeGraphViewportPerf.cullRaf) {
    nodeGraphViewportPerf.cullPendingOptions = {
      cacheSizesOnly: cacheSizesOnly
        || Boolean(nodeGraphViewportPerf.cullPendingOptions?.cacheSizesOnly),
    };
    return;
  }
  const pending = { cacheSizesOnly };
  nodeGraphViewportPerf.cullRaf = window.requestAnimationFrame(() => {
    nodeGraphViewportPerf.cullRaf = 0;
    const opts = nodeGraphViewportPerf.cullPendingOptions || pending;
    nodeGraphViewportPerf.cullPendingOptions = null;
    nodeGraphViewportPerf.cullLastAt = performance.now?.() || Date.now();
    nodeGraphViewportCullRefresh(opts);
  });
}

/**
 * Keep the *face* painting when it is teleported. Never unhide a graph
 * module that does not belong in the current view (Voice* / Meta Out / interiors).
 */
function nodeGraphViewportCullMustStayAwake(elementOrNodeId) {
  const element = elementOrNodeId instanceof Element
    ? (elementOrNodeId.classList.contains("dsp-node")
      ? elementOrNodeId
      : elementOrNodeId.closest?.(".dsp-node"))
    : (typeof nodeGraphNodeElement === "function"
      ? nodeGraphNodeElement(elementOrNodeId)
      : null);
  if (element?.hidden) {
    return false;
  }
  const nodeId = String(
    (element?.dataset?.node || elementOrNodeId || ""),
  ).trim();
  if (!nodeId) {
    return false;
  }
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (
    patchNode
    && typeof nodeGraphMetamoduleNodeVisibleInCurrentView === "function"
    && !nodeGraphMetamoduleNodeVisibleInCurrentView(patchNode)
  ) {
    return false;
  }
  if (element?.querySelector?.(":scope > .node-screen-solo-placeholder, .node-screen-solo-placeholder")) {
    return true;
  }
  if (nodeGraphDisplayIsPresented(nodeId)) {
    return true;
  }
  if (typeof nodeGraphLayoutCanvasIsActive === "function" && nodeGraphLayoutCanvasIsActive()) {
    if (typeof nodeGraphLayoutCanvasIsPinned === "function" && nodeGraphLayoutCanvasIsPinned(nodeId)) {
      return true;
    }
  }
  return false;
}

function nodeGraphViewportCullWakePresentedFace(nodeId) {
  const id = String(nodeId || "").trim();
  if (!id) {
    return;
  }
  const face = typeof nodeGraphPresentedDisplayFace === "function"
    ? nodeGraphPresentedDisplayFace(id)
    : null;
  if (face && typeof nodeGraphScreenSoloWakeFace === "function") {
    nodeGraphScreenSoloWakeFace(face);
  }
  if (id && typeof requestNodeGraphModuleScopeRepaint === "function") {
    requestNodeGraphModuleScopeRepaint(id);
  }
}

function nodeGraphViewportCullWakeNodeById(nodeId) {
  const id = String(nodeId || "").trim();
  if (!id) {
    return;
  }
  nodeGraphViewportCullWakePresentedFace(id);
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, "");
  const host = document.querySelector(`.dsp-node[data-node="${escaped}"]`);
  if (!host || host.hidden) {
    return;
  }
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(id) : null;
  if (
    patchNode
    && typeof nodeGraphMetamoduleNodeVisibleInCurrentView === "function"
    && !nodeGraphMetamoduleNodeVisibleInCurrentView(patchNode)
  ) {
    return;
  }
  nodeGraphViewportCullApply(host, true);
}

function nodeGraphViewportCullApply(element, intersecting) {
  if (!element?.classList?.contains("dsp-node")) {
    return;
  }
  const nodeId = String(element.dataset?.node || "");
  if (element.hidden) {
    const wasAsleep = element.classList.contains("viewport-asleep");
    element.classList.add("viewport-asleep");
    if (!wasAsleep) {
      nodeGraphViewportCullSleepPainters(element);
    }
    nodeGraphViewportCullWakePresentedFace(nodeId);
    return;
  }
  const selected = Boolean(
    nodeId
    && typeof nodeGraphSelectedNodeIds === "function"
    && nodeGraphSelectedNodeIds().has(nodeId),
  );
  const stay = nodeGraphViewportCullMustStayAwake(element);
  const awake = intersecting || selected || stay;
  const wasAsleep = element.classList.contains("viewport-asleep");
  element.classList.toggle("viewport-asleep", !awake);
  if (wasAsleep === !awake) {
    return;
  }
  if (awake) {
    nodeGraphViewportCullWakePainters(element);
  } else {
    nodeGraphViewportCullSleepPainters(element);
  }
}

function ensureNodeGraphViewportModuleCull() {
  const root = document.getElementById("nodeGraphWorkspace");
  if (!root || typeof IntersectionObserver !== "function") {
    return null;
  }
  if (nodeGraphViewportCull.observer) {
    return nodeGraphViewportCull.observer;
  }
  nodeGraphViewportCull.observer = new IntersectionObserver((entries) => {
    if (nodeGraphViewportCullBootOrLayoutUnsafe()) {
      for (const entry of entries) {
        const node = entry.target?.classList?.contains("dsp-node")
          ? entry.target
          : entry.target?.closest?.(".dsp-node");
        if (node) {
          nodeGraphViewportCullApply(node, true);
        }
      }
      return;
    }
    for (const entry of entries) {
      const node = entry.target?.classList?.contains("dsp-node")
        ? entry.target
        : entry.target?.closest?.(".dsp-node");
      if (node) {
        // Text Boxes: a false non-intersect (camera still at 0, nodes at
        // negative gx) sets display:none and this observer never retries.
        // Geometric refresh owns sleep/wake for the annotation host.
        const annotations = document.getElementById("nodeGraphAnnotationNodes");
        if (annotations?.contains(node) && !entry.isIntersecting) {
          continue;
        }
        nodeGraphViewportCullApply(node, entry.isIntersecting);
      }
    }
  }, {
    root,
    rootMargin: "160px",
    threshold: 0,
  });
  return nodeGraphViewportCull.observer;
}

function nodeGraphViewportCullObserve(element) {
  const node = element?.classList?.contains("dsp-node")
    ? element
    : element?.closest?.(".dsp-node");
  if (!node) {
    return;
  }
  const observer = ensureNodeGraphViewportModuleCull();
  if (observer) {
    try {
      observer.observe(node);
    } catch (_error) {
      // Ignore detached / double-observe.
    }
  }
  scheduleNodeGraphViewportCullRefresh();
}

function nodeGraphViewportCullSyncSelection() {
  const selected = typeof nodeGraphSelectedNodeIds === "function"
    ? nodeGraphSelectedNodeIds()
    : new Set();
  for (const id of selected) {
    const element = typeof nodeGraphNodeElement === "function"
      ? nodeGraphNodeElement(id)
      : null;
    if (element?.classList.contains("viewport-asleep")) {
      nodeGraphViewportCullApply(element, true);
    }
  }
}

function flushNodeGraphViewportImmediate(options = {}) {
  if (nodeGraphViewportPerf.heavyRaf) {
    window.cancelAnimationFrame(nodeGraphViewportPerf.heavyRaf);
    nodeGraphViewportPerf.heavyRaf = 0;
  }
  if (nodeGraphViewportPerf.settleTimer) {
    window.clearTimeout(nodeGraphViewportPerf.settleTimer);
    nodeGraphViewportPerf.settleTimer = 0;
  }
  nodeGraphViewportPerf.wheelActiveUntil = 0;
  clearNodeGraphViewportGestureClass();
  applyNodeGraphViewportCssLight({
    zoom: options.zoom !== false,
    pan: options.pan !== false,
  });
  flushNodeGraphViewportHeavyChrome({ full: true });
  if (options.persist !== false) {
    scheduleNodeGraphWorkspaceViewPersist();
  }
}
