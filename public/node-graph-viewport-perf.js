// Viewport (zoom/pan) performance: light CSS every event, heavy chrome
// (wires / heatmap / scopes) coalesced to rAF; full fidelity + settings
// persist after the gesture settles.
// Camera: GPU shader. World layers stay untransformed. Each module uses
// CSS zoom (not transform:scale) so carets and edit fields stay on the
// glyphs. offsetWidth stays zoom-1, which the GPU plate measures.

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

function nodeGraphEnsureTextWireLayers(host) {
  const workspace = host || document.getElementById("nodeGraphWorkspace");
  if (!workspace) return;
  const zoom = workspace.querySelector(".node-graph-zoom-surface");
  let behind = document.getElementById("nodeGraphTextBehind");
  if (!behind) {
    behind = document.createElement("div");
    behind.id = "nodeGraphTextBehind";
    behind.className = "node-graph-text-behind";
    if (zoom) workspace.insertBefore(behind, zoom);
    else workspace.append(behind);
  }
  let front = document.getElementById("nodeGraphTextFront");
  if (!front) {
    front = document.createElement("div");
    front.id = "nodeGraphTextFront";
    front.className = "node-graph-text-front";
    workspace.append(front);
  }
}

function nodeGraphPositionGridHtml() {
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (!workspace) return;
  // Frozen mid-gesture: the layer transform carries the modules (ZP-4).
  if (nodeGraphViewportPerf.htmlFrozen) return;
  nodeGraphEnsureTextWireLayers(workspace);
  const zoom = Math.max(
    0.0001,
    typeof nodeGraphZoom === "function" ? nodeGraphZoom() : (nodeGraphMvp?.zoom || 1),
  );
  const pan = nodeGraphMvp?.pan || { x: 0, y: 0 };
  const origin = typeof nodeGraphRenderedOriginOffset === "function"
    ? nodeGraphRenderedOriginOffset(pan, workspace)
    : pan;
  const panX = Number(origin?.x) || 0;
  const panY = Number(origin?.y) || 0;
  const behind = document.getElementById("nodeGraphTextBehind");
  const front = document.getElementById("nodeGraphTextFront");
  const nodes = workspace.querySelectorAll("#nodeGraphWorldLayer .dsp-node, #nodeGraphAnnotationWorldLayer .dsp-node, #nodeGraphTextBehind .dsp-node, #nodeGraphTextFront .dsp-node");
  // Zoom scales around the layer origin, so layout left (wx) already lands
  // at wx * zoom. The translate is only the camera origin, in pre-zoom px.
  const zoomText = String(zoom);
  const transform = `translate(${panX / zoom}px, ${panY / zoom}px)`;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.closest?.(".node-layout-canvas-tile, .node-screen-solo-stage")) continue;
    const text = node.querySelector(":scope > .node-text-box-body");
    if (text && behind && front) {
      const layout = nodeGraphMvp?.patch?.nodes?.find?.((item) => item?.id === node.dataset.node)?.layout;
      const place = layout?.wireStack === "behind" ? behind : front;
      if (node.parentElement !== place) place.append(node);
    }
    if (node.style.zoom !== zoomText) node.style.zoom = zoomText;
    if (node.style.transformOrigin !== "0px 0px") node.style.transformOrigin = "0 0";
    if (node.style.transform !== transform) node.style.transform = transform;
  }
  nodeGraphViewportPerf.htmlCamera = { zoom, x: panX, y: panY };
  const layers = workspace.getElementsByClassName("node-graph-world-layer");
  for (let i = 0; i < layers.length; i += 1) {
    layers[i].style.transform = "none";
  }
}

// ZP-4 frozen module HTML. Mid-gesture no module style is written: each
// module keeps the CSS zoom and translate it had when the gesture began, and
// one transform per world/text layer carries the whole HTML picture from the
// frozen camera to the live one (hit targets stay on the GPU plates). Settle
// writes CSS zoom, --node-graph-zoom and the module transforms once.
function nodeGraphHtmlFreezeLayers(workspace) {
  const layers = [];
  const world = workspace.getElementsByClassName("node-graph-world-layer");
  for (let i = 0; i < world.length; i += 1) layers.push(world[i]);
  const behind = document.getElementById("nodeGraphTextBehind");
  const front = document.getElementById("nodeGraphTextFront");
  if (behind) layers.push(behind);
  if (front) layers.push(front);
  return layers;
}

function nodeGraphHtmlFrozen() {
  return Boolean(nodeGraphViewportPerf.htmlFrozen);
}

function nodeGraphFreezeHtmlCamera(workspace) {
  if (nodeGraphViewportPerf.htmlFrozen || !workspace) return nodeGraphViewportPerf.htmlFrozen;
  // Freeze at the camera the HTML was last written for, not the new sample.
  const last = nodeGraphViewportPerf.htmlCamera;
  if (!last) return null;
  nodeGraphViewportPerf.htmlFrozen = { zoom: last.zoom, x: last.x, y: last.y };
  return nodeGraphViewportPerf.htmlFrozen;
}

function nodeGraphApplyFrozenHtmlCamera(workspace, originX, originY) {
  const frozen = nodeGraphViewportPerf.htmlFrozen;
  if (!frozen) return;
  const zoom = Math.max(
    0.0001,
    typeof nodeGraphZoom === "function" ? nodeGraphZoom() : (nodeGraphMvp?.zoom || 1),
  );
  // Screen p0 = w * z0 + o0 maps to p = w * z + o: p = p0 * s + (o - o0 * s).
  const sc = zoom / Math.max(0.0001, frozen.zoom);
  const tx = (Number(originX) || 0) - frozen.x * sc;
  const ty = (Number(originY) || 0) - frozen.y * sc;
  const transform = `translate(${tx}px, ${ty}px) scale(${sc})`;
  const layers = nodeGraphHtmlFreezeLayers(workspace);
  for (let i = 0; i < layers.length; i += 1) {
    const style = layers[i].style;
    if (style.transformOrigin !== "0px 0px") style.transformOrigin = "0 0";
    style.transform = transform;
  }
}

function nodeGraphThawHtmlCamera(workspace) {
  if (!nodeGraphViewportPerf.htmlFrozen) return;
  nodeGraphViewportPerf.htmlFrozen = null;
  const el = workspace || document.getElementById("nodeGraphWorkspace");
  if (!el) return;
  const pan = nodeGraphMvp?.pan || { x: 0, y: 0 };
  const origin = typeof nodeGraphRenderedOriginOffset === "function"
    ? nodeGraphRenderedOriginOffset(pan, el)
    : pan;
  // Layers back to identity; modules get the live zoom + translate once.
  nodeGraphApplyPanVarsToWorldLayers(el, `${origin.x}px`, `${origin.y}px`);
  const behind = document.getElementById("nodeGraphTextBehind");
  const front = document.getElementById("nodeGraphTextFront");
  if (behind) behind.style.transform = "";
  if (front) front.style.transform = "";
}

function nodeGraphApplyPanVarsToWorldLayers(workspace, x, y) {
  if (!workspace) {
    return;
  }
  if (nodeGraphViewportPerf.htmlFrozen) {
    nodeGraphApplyFrozenHtmlCamera(workspace, Number.parseFloat(x), Number.parseFloat(y));
    return;
  }
  if (!nodeGraphWorldLayerCollection || nodeGraphWorldLayerCollection.owner !== workspace) {
    nodeGraphWorldLayerCollection = {
      owner: workspace,
      layers: workspace.getElementsByClassName("node-graph-world-layer"),
    };
  }
  const layers = nodeGraphWorldLayerCollection.layers;
  for (let i = 0; i < layers.length; i += 1) {
    layers[i].style.setProperty("--node-graph-pan-x", x);
    layers[i].style.setProperty("--node-graph-pan-y", y);
    layers[i].style.transform = "none";
  }
  nodeGraphPositionGridHtml();
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

// Gesture display hold. While a pan/zoom gesture is active, scope frames and
// face pumps skip painting so the world layer moves as a cached GPU layer;
// settle repaints everything. False keeps live displays animating mid-zoom.
const NODE_GRAPH_GESTURE_HOLD_DISPLAYS = false;

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
  if (nodeGraphViewportPerf.htmlFrozen) {
    nodeGraphThawHtmlCamera(workspace);
    scheduleNodeGraphViewportCullRefresh();
  }
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
    if (cameraGesturing) nodeGraphFreezeHtmlCamera(workspace);
    else nodeGraphThawHtmlCamera(workspace);
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
  // Mid-gesture: grid cell, phase and module glows follow the camera once a
  // frame from cached bounds (ZP-4: the stale glows were the light blobs).
  if (gesturing && !nodeGraphViewportPerf.heatmapCameraRaf && typeof updateNodeGraphGridHeatmap === "function") {
    nodeGraphViewportPerf.heatmapCameraRaf = window.requestAnimationFrame(() => {
      nodeGraphViewportPerf.heatmapCameraRaf = 0;
      if (nodeGraphViewportGestureActive()) updateNodeGraphGridHeatmap({ camera: true });
    });
  }
  // Mid-gesture: skip heatmap phase updates (esp. costly at high zoom).
  // Settle / pointer-up restores via flushNodeGraphViewportHeavyChrome.
  // Cull must keep running while zoomed-in pan: otherwise modules that leave
  // the view stay awake (display:block) and the composited layer keeps growing
  // → "I'm zoomed in and pan is laggy for no reason." Use cached sizes only.
  // Frozen HTML (ZP-4): waking or sleeping a module mid-gesture re-lays it
  // out and fires its resize observers. The GPU plates are drawn for every
  // module anyway; settle culls once.
  if (!gesturing || !nodeGraphViewportPerf.htmlFrozen) {
    scheduleNodeGraphViewportCullRefresh({
      cacheSizesOnly: gesturing,
      minIntervalMs: gesturing ? 48 : 0,
    });
  }
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
  // B-101: reconcile sleep/wake for the final camera BEFORE the GL rebuild.
  // The cull used to be a queued rAF that ran after this pass, so the GL
  // rebuild below skipped faces of modules that were still asleep (display:none
  // has no layout box) and nothing rebuilt them once they woke.
  nodeGraphViewportCullFlushNow();
  // Republish modules that are on screen. Offscreen modules stay display:none
  // and keep the attaches they already have, so their cables still have ends.
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
  // Engine-state plan: a buffer face waking while stopped (or paused with no
  // held canvas) gets its canvas and cold plate, same as a stopped spawn.
  nodeGraphViewportWakeColdPlate(nodeId);
  element.dispatchEvent(new CustomEvent("nodegraphviewport", {
    bubbles: false,
    detail: { asleep: false },
  }));
}

function nodeGraphViewportWakeColdPlate(nodeId) {
  if (
    !nodeId
    || typeof scopePaintEnsureColdPlate !== "function"
    || typeof scopePaintEngineState !== "function"
    || typeof requestAnimationFrame !== "function"
  ) {
    return;
  }
  requestAnimationFrame(() => {
    const state = scopePaintEngineState();
    const slot = nodeGraphModuleScopeState?.slots?.get?.(nodeId);
    if (!slot || state === "playing") return;
    if (state === "paused") {
      const held = slot.scopeElement?.querySelector?.("canvas");
      if (held && held.width > 1 && held.height > 1) return;
    }
    scopePaintEnsureColdPlate(slot, { create: true, force: true, assumeStopped: true });
  });
}

function nodeGraphViewportCullSleepPainters(element) {
  if (!element) {
    return;
  }
  if (typeof nodeGraphViewportCullMustStayAwake === "function"
    && nodeGraphViewportCullMustStayAwake(element)) {
    return;
  }
  // Video nodes (VG-4) keep running while a visible sink reads their picture.
  const videoNeeded = typeof nodeGraphVideoGraphShouldSleep === "function"
    && !nodeGraphVideoGraphShouldSleep(element.dataset?.node);
  for (const face of element.querySelectorAll(".node-fbm-field-face")) {
    if (!videoNeeded && typeof nodeGraphFbmFieldStopLoop === "function") {
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

/** B-101: run the geometric cull now (live camera), dropping any queued one. */
function nodeGraphViewportCullFlushNow() {
  if (nodeGraphViewportPerf.cullRaf) {
    window.cancelAnimationFrame(nodeGraphViewportPerf.cullRaf);
    nodeGraphViewportPerf.cullRaf = 0;
  }
  if (nodeGraphViewportPerf.cullTrailingTimer) {
    window.clearTimeout(nodeGraphViewportPerf.cullTrailingTimer);
    nodeGraphViewportPerf.cullTrailingTimer = 0;
  }
  nodeGraphViewportPerf.cullPendingOptions = null;
  nodeGraphViewportPerf.cullLastAt = performance.now?.() || Date.now();
  nodeGraphViewportCullFlushing = true;
  try {
    nodeGraphViewportCullRefresh();
  } finally {
    nodeGraphViewportCullFlushing = false;
  }
}

// B-101: a module woken outside a full chrome pass (observer, selection,
// metamodule, trailing cull) needs its GL plate + display faces rebuilt —
// the last rebuild skipped it while it was display:none. One rAF, coalesced.
let nodeGraphViewportCullFlushing = false;
let nodeGraphViewportWakeRebuildRaf = 0;
function scheduleNodeGraphViewportWakeRebuild() {
  if (nodeGraphViewportCullFlushing || nodeGraphViewportWakeRebuildRaf) return;
  if (typeof nodeGraphGlGraphRebuildPlates !== "function") return;
  nodeGraphViewportWakeRebuildRaf = window.requestAnimationFrame(() => {
    nodeGraphViewportWakeRebuildRaf = 0;
    // Mid-gesture the settle pass rebuilds everything once.
    if (nodeGraphViewportGestureActive()) return;
    if (typeof nodeGraphModuleGeometryPublishVisible === "function") {
      nodeGraphModuleGeometryPublishVisible();
    }
    nodeGraphGlGraphRebuildPlates();
    if (typeof nodeGraphGlGraphPresent === "function") nodeGraphGlGraphPresent();
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
  if (typeof nodeGraphMiniPerformPresentsNode === "function" && nodeGraphMiniPerformPresentsNode(nodeId)) {
    return true; // Mini Performance View is showing it.
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
    scheduleNodeGraphViewportWakeRebuild();
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
    // Frozen HTML mid-gesture (ZP-4): a sleep/wake is a module re-layout plus
    // its resize observers. The thaw runs one geometric cull for every module.
    if (nodeGraphViewportPerf.htmlFrozen) {
      return;
    }
    // B-101: the observer may only WAKE. Its entries arrive async and can
    // describe an older camera: pan out (geometric cull sleeps the module,
    // queuing a "not intersecting" entry), pan back fast (geometric cull
    // wakes it), then the stale entry lands and sleeps it again. display:none
    // never changes intersection again, so the module stayed bodiless. A
    // non-intersect now asks the geometric cull (live camera) to decide.
    let needsGeometricCull = false;
    for (const entry of entries) {
      const node = entry.target?.classList?.contains("dsp-node")
        ? entry.target
        : entry.target?.closest?.(".dsp-node");
      if (!node) continue;
      if (entry.isIntersecting) {
        nodeGraphViewportCullApply(node, true);
      } else {
        needsGeometricCull = true;
      }
    }
    if (needsGeometricCull) {
      scheduleNodeGraphViewportCullRefresh();
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
