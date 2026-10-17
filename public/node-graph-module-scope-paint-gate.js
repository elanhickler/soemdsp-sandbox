// Scope paint gate — single source of truth for live / pause / freeze / schedule.
//
// Graphify cannot see worklet postMessage → main draw as a call path. The freeze
// bugs (paint only on Settings / Unpause) came from the same predicates being
// re-implemented in canvas, phosphor, orchestrator, lifecycle, and buffer-io.
// All of those decisions go through this file.
//
// Load after node-graph-state / mvp exists; used by scope-canvas, phosphor,
// draw-orchestrator, lifecycle, buffer-io. Extract-only policy helpers.

/** Live AudioWorklet node, or the plugin's native host (window.soemdspPluginHost). */
function scopePaintHasEngineHost(live) {
  if (live?.node) return true;
  return typeof window !== "undefined" && Boolean(window.soemdspPluginHost);
}

/**
 * Engine transport is playing (speed > 0) and a live audio node exists.
 * Does not require Live Output or AudioContext.state === "running".
 */
function scopePaintIsEnginePlaying() {
  const live = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.live : null;
  if (!scopePaintHasEngineHost(live)) {
    return false;
  }
  const speed = Number(live.speedMultiplier);
  // Default speed is 1 when unset; only explicit 0 means paused.
  if (Number.isFinite(speed)) {
    return speed > 0;
  }
  return true;
}

/** Live Output is on (sample stream / speaker path). */
function scopePaintIsLiveOutputOn() {
  const live = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.live : null;
  return Boolean(live?.outputEnabled);
}

/** Display Settings / patch overlay: scopes frozen without stopping audio. */
function scopePaintIsVisualPaused() {
  const visualPause = nodeGraphFiniteNumber(
    typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.visualControls?.scopePaused : 0,
  );
  return visualPause > 0.5;
}

/**
 * Full live paint loop should run (RAF + sample force paints).
 * Live graph never freezes for the magnifier. The lens is a snapshot clone;
 * scopes on the patch keep drawing.
 */
function nodeGraphDisplaysFrozen() {
  return false;
}

/**
 * Drawing faces (basicShape, roundShape, filter curves, …) may animate from
 * transport alone — Live Output is not required. Not for realtime field
 * drawers (FBM field) or phosphor / Instant Waterfall.
 */
function scopePaintIsDrawingLive() {
  if (scopePaintIsVisualPaused()) {
    return false;
  }
  return scopePaintIsEnginePlaying();
}

/**
 * Heavy realtime screens (phosphor, Instant Waterfall / strip traces, FBM field).
 * Need Live Output so the sample / domain stream is actually pumping.
 */
function scopePaintIsRealtimeSampleLive() {
  if (scopePaintIsVisualPaused()) {
    return false;
  }
  return scopePaintIsEnginePlaying() && scopePaintIsLiveOutputOn();
}

/**
 * @deprecated Prefer scopePaintIsDrawingLive / scopePaintIsRealtimeSampleLive.
 * Kept as drawing-live (no Live Output) for shape / curve face RAF helpers.
 */
function scopePaintIsLive() {
  return scopePaintIsDrawingLive();
}

/**
 * Per-module face RAF for drawing faces (shapes / curves). Live Output not
 * required. Realtime drawers (FBM field) use scopePaintIsRealtimeSampleLive.
 * Paint cadence inside the loop is Simulation FPS via nodeGraphSimFpsShouldPaint
 * — not every vsync. Mouse / param / resize call paint() immediately (force).
 */
function scopePaintFaceShouldAnimate(faceOrNode) {
  if (!scopePaintIsDrawingLive()) {
    return false;
  }
  const nodeId = faceOrNode?.dataset?.node
    || (typeof faceOrNode === "string" ? faceOrNode : "")
    || "";
  const mirrorSubscribed = nodeId
    && typeof nodeGraphMetamoduleChildIsMirrorSubscribed === "function"
    && nodeGraphMetamoduleChildIsMirrorSubscribed(nodeId);
  // Mirrored children stay awake even when the article is hidden / culled on Root.
  if (
    !mirrorSubscribed
    && typeof nodeGraphModuleIsViewportAsleep === "function"
    && nodeGraphModuleIsViewportAsleep(faceOrNode)
  ) {
    return false;
  }
  if (
    nodeId
    && typeof nodeGraphScreenSoloIsActive === "function"
    && nodeGraphScreenSoloIsActive()
    && typeof nodeGraphScreenSoloAllowsNode === "function"
    && !nodeGraphScreenSoloAllowsNode(nodeId)
  ) {
    return false;
  }
  return true;
}

/**
 * Shared rAF pump for drawing faces. Keeps the loop alive while animate;
 * paints only when Simulation FPS says so (or host force flag is set).
 * Prefer immediate paint() from syncFromParameters / resize / slider drag,
 * then arm this loop — do not wait a frame for UI feedback.
 */
function nodeGraphArmDrawingFaceLoop(host, options = {}) {
  if (!host) {
    return;
  }
  const paint = options.paint;
  if (typeof paint !== "function") {
    return;
  }
  const rafKey = options.rafKey || "_raf";
  const forceKey = options.forceKey || "_forceDraw";
  if (host[rafKey]) {
    return;
  }
  const clockKeyFor = typeof options.clockKey === "function"
    ? options.clockKey
    : () => String(options.clockKey || host.dataset?.nodeType || "face");
  const stillAnimate = typeof options.shouldAnimate === "function"
    ? () => options.shouldAnimate(host)
    : () => (
      typeof scopePaintFaceShouldAnimate === "function"
        ? scopePaintFaceShouldAnimate(host)
        : (typeof scopePaintIsLive === "function" ? scopePaintIsLive() : true)
    );
  const tick = () => {
    host[rafKey] = 0;
    if (host.isConnected === false) {
      return;
    }
    // Mid pan/zoom: hold the face (cheap re-arm, no paint) until settle.
    if (typeof nodeGraphViewportHoldsDisplays === "function" && nodeGraphViewportHoldsDisplays()) {
      host[rafKey] = requestAnimationFrame(tick);
      return;
    }
    const force = Boolean(host[forceKey]);
    if (!stillAnimate()) {
      if (force) {
        paint(host);
      }
      return;
    }
    if (
      typeof nodeGraphSimFpsShouldPaint === "function"
      && !nodeGraphSimFpsShouldPaint(clockKeyFor(host), force)
    ) {
      // FPS ≤ 0 freezes — do not spin waiting for a tick that never comes.
      if (typeof nodeGraphSimFpsRate === "function" && !(nodeGraphSimFpsRate() > 0)) {
        return;
      }
      host[rafKey] = requestAnimationFrame(tick);
      return;
    }
    paint(host);
    if (stillAnimate()) {
      host[rafKey] = requestAnimationFrame(tick);
    }
  };
  host[rafKey] = requestAnimationFrame(tick);
}

/**
 * Wire Simulation-FPS pump + param sync + resize + wake listeners on a face.
 * Returns startLoop. Call after canvas is appended.
 */
function nodeGraphInstallDrawingFacePump(section, options = {}) {
  if (!section || typeof options.paint !== "function") {
    return () => {};
  }
  const paint = options.paint;
  const forceKey = options.forceKey || "_forceDraw";
  // ES-1: the face declares its paint kind (param / buffer / modulation).
  if (options.paintKind && typeof nodeGraphDeclareFacePaintKind === "function") {
    nodeGraphDeclareFacePaintKind(section, options.paintKind);
  }
  const startLoop = () => {
    nodeGraphArmDrawingFaceLoop(section, {
      paint,
      clockKey: options.clockKey,
      forceKey,
      rafKey: options.rafKey || "_raf",
      shouldAnimate: options.shouldAnimate,
    });
  };
  section._startFaceLoop = startLoop;
  if (options.ownSync !== false) {
    section.syncFromParameters = () => {
      section[forceKey] = true;
      if (typeof options.onSync === "function") {
        options.onSync(section);
      }
      paint(section);
      startLoop();
    };
  }
  if (options.observeResize !== false && typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => {
      section[forceKey] = true;
      // SyncLayout before paint — face CSS/buffer metrics are resize-owned.
      if (typeof syncFaceMetrics === "function") {
        syncFaceMetrics(section);
      }
      if (typeof options.onResize === "function") {
        options.onResize(section);
      }
      paint(section);
      startLoop();
    });
    ro.observe(section);
    section._drawingFaceResizeObserver = ro;
  }
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("nodegraphfaceloops", startLoop);
  }
  section.addEventListener?.("nodegraphviewport", (event) => {
    if (!event?.detail?.asleep) {
      startLoop();
    }
  });
  if (options.paintOnCreate !== false) {
    paint(section);
    startLoop();
  }
  return startLoop;
}

/** Wake stopped face loops after Play / speed>0 / viewport wake. */
function scopePaintNotifyFaceLoops() {
  if (typeof document === "undefined" || typeof document.dispatchEvent !== "function") {
    return;
  }
  try {
    document.dispatchEvent(new CustomEvent("nodegraphfaceloops", { bubbles: false }));
  } catch (_e) { /* ignore */ }
}

/**
 * Phosphor residual hold: no new deposits / no Instant Waterfall rewrite.
 * Intentional pause only — never "AudioContext suspended" or missing circuit flag.
 *
 * Full Stop (no live worklet node) is NOT freeze. Stop must cold-boot LCD/LED
 * idle plates. Treating stopped as frozen made play→pause→stop leave faces
 * stuck in the paused residual frame forever (cold boot early-out).
 */
function scopePaintIsFrozen() {
  // Display Settings freeze always holds residual (audio may still run).
  if (scopePaintIsVisualPaused()) {
    return true;
  }
  const live = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.live : null;
  // Engine fully down → cold-boot / idle territory, not residual hold.
  if (!scopePaintHasEngineHost(live)) {
    return false;
  }
  // Worklet still up but transport speed 0 → pause: hold residual.
  return !scopePaintIsEnginePlaying();
}

/**
 * Legacy name used across the codebase. Prefer scopePaintIsLive / scopePaintIsFrozen
 * for new code. "Paused" here means "do not run full live draw unless force".
 */
function scopePaintIsPaused() {
  return !scopePaintIsLive();
}

/**
 * Full compositor draw (phosphor deposits + Instant Waterfall / sample faces).
 * Requires Live Output. force=true still allowed for Clear / Settings plates.
 */
function scopePaintShouldFullDraw(force = false) {
  if (force === true) {
    return true;
  }
  if (typeof nodeGraphOutputInkWantsFrames === "function" && nodeGraphOutputInkWantsFrames()) {
    return true;
  }
  return scopePaintIsRealtimeSampleLive();
}

/**
 * After a successful full draw, should we request another RAF?
 */
function scopePaintShouldKeepLoop() {
  if (typeof nodeGraphOutputInkWantsFrames === "function" && nodeGraphOutputInkWantsFrames()) {
    if (typeof nodeGraphModuleScopeHasDrawableSlots === "function") {
      return nodeGraphModuleScopeHasDrawableSlots();
    }
    return true;
  }
  if (!scopePaintIsRealtimeSampleLive()) {
    return false;
  }
  if (typeof nodeGraphModuleScopeState !== "undefined" && nodeGraphModuleScopeState?.idleHold) {
    return false;
  }
  if (typeof nodeGraphModuleScopeHasDrawableSlots === "function") {
    return nodeGraphModuleScopeHasDrawableSlots();
  }
  return true;
}

/**
 * Instant Waterfall signature skip: never while realtime sample stream is live.
 * When idle / Live Output off, callers may cache static frames.
 */
function scopePaintShouldSkipUnchangedTrace() {
  return !scopePaintIsRealtimeSampleLive();
}

/**
 * Arm continuous draw after worklet samples land.
 *
 * Soft schedule only — `{ force: true }` skips the display FPS clock
 * (`nodeGraphModuleScopePhosphorFrameReady`), so every sample batch was painting
 * at audio/rAF rate and ignoring Simulation FPS (phosphor, LCD, LED, 0D, …).
 * Clear / Settings / wipe still pass force when an immediate paint is required.
 * The live RAF loop is kept alive by scopePaintKeepLoopAlive after each frame.
 */
const nodeGraphScopeIdleHoldEpsilon = 1e-4;

function nodeGraphScopeSamplesIdleSilent(samples) {
  if (!samples) {
    return true;
  }
  const n = nodeGraphFiniteNumber(samples.length);
  if (!n) {
    return true;
  }
  const step = Math.max(1, Math.floor(n / 64));
  for (let i = 0; i < n; i += step) {
    if (Math.abs(nodeGraphFiniteNumber(samples[i])) > nodeGraphScopeIdleHoldEpsilon) {
      return false;
    }
  }
  return Math.abs(nodeGraphFiniteNumber(samples[n - 1])) <= nodeGraphScopeIdleHoldEpsilon;
}

function nodeGraphModuleScopeBuffersIdleSilent() {
  const buffers = typeof nodeGraphModuleScopeState !== "undefined"
    ? nodeGraphModuleScopeState?.buffers
    : null;
  if (!buffers || typeof buffers.values !== "function") {
    return false;
  }
  let any = false;
  for (const buffer of buffers.values()) {
    any = true;
    if (!nodeGraphScopeSamplesIdleSilent(buffer)) {
      return false;
    }
  }
  return any;
}

function scopePaintOnSampleSnapshot() {
  if (typeof scheduleNodeGraphModuleScopeDraw !== "function") {
    return;
  }
  const silent = typeof nodeGraphModuleScopeBuffersIdleSilent === "function"
    && nodeGraphModuleScopeBuffersIdleSilent();
  if (silent && nodeGraphModuleScopeState?.idleHold) {
    return;
  }
  if (!silent && nodeGraphModuleScopeState) {
    nodeGraphModuleScopeState.idleHold = false;
  }
  if (typeof scopePaintNotifyFaceLoops === "function") {
    scopePaintNotifyFaceLoops();
  }
  scheduleNodeGraphModuleScopeDraw();
}

/**
 * Keep RAF alive during transient failures (no buffer yet, canvas sync, etc.).
 */
function scopePaintKeepLoopAlive() {
  if (!scopePaintShouldKeepLoop()) {
    return;
  }
  if (typeof scheduleNodeGraphModuleScopeDraw === "function") {
    scheduleNodeGraphModuleScopeDraw();
  }
}

// --- Compatibility shims (existing names) ---------------------------------

function nodeGraphModuleScopeLivePaintActive() {
  return scopePaintIsRealtimeSampleLive();
}

function nodeGraphModuleScopeEnginePaused() {
  return !scopePaintIsEnginePlaying();
}

function nodeGraphModuleScopePhosphorFrozen() {
  return scopePaintIsFrozen();
}

function scopePaintIsEngineStopped() {
  const live = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.live : null;
  return !live?.node;
}

function scopePaintIsFacePoweredOff(nodeId) {
  const id = String(nodeId || "").trim();
  if (!id) return false;
  if (typeof nodeGraphNodeDisplaysBypassed === "function") {
    return nodeGraphNodeDisplaysBypassed(id);
  }
  if (typeof nodeGraphNodeIsBypassed === "function") {
    return nodeGraphNodeIsBypassed(id);
  }
  const listed = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.patch?.bypassedNodes : null;
  return Array.isArray(listed) && listed.includes(id);
}

/**
 * Wipe this face to its cold plate instead of drawing it.
 * Power-off always wipes. Engine stop wipes buffer / modulation faces only;
 * param faces keep painting while stopped (ES-2, APP_POLICY 3b).
 */
function scopePaintShouldColdBootFace(nodeId, slot) {
  if (scopePaintIsFacePoweredOff(nodeId)) {
    return true;
  }
  if (!scopePaintIsEngineStopped()) {
    return false;
  }
  if (typeof nodeGraphFacePaintKindFor !== "function") {
    return true;
  }
  const kind = nodeGraphFacePaintKindFor(slot || nodeId);
  return scopePaintFacePolicy(kind, "stopped").black;
}

// --- Engine state and face paint policy (ES-1, docs/ENGINE_STATE_DISPLAY_PLAN.md) ---
//
// APP_POLICY 3b: displays work while stopped. Param faces paint on create and
// on every parameter change in every engine state; buffer faces are black when
// stopped and frozen when paused; modulation faces may wait for start. UI is
// never gated on engine state. New display code asks scopePaintFacePolicy()
// instead of reading live.node / outputEnabled / speedMultiplier itself.

/** "stopped" (no engine host), "paused" (host up, speed 0), or "playing". */
function scopePaintEngineState() {
  const live = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.live : null;
  if (!scopePaintHasEngineHost(live)) {
    return "stopped";
  }
  return scopePaintIsEnginePlaying() ? "playing" : "paused";
}

const NODE_GRAPH_FACE_PAINT_KINDS = ["param", "buffer", "modulation"];

/**
 * Declared kinds, keyed by display renderer or node type. Faces may also
 * declare per element (data-face-paint) via nodeGraphDeclareFacePaintKind or
 * nodeGraphInstallDrawingFacePump({ paintKind }). Unlisted faces are "buffer"
 * (the old behaviour: black while stopped, held while paused).
 */
const nodeGraphFacePaintKindTable = Object.assign(Object.create(null), {
  // Parameter-driven pictures (curves, shapes, keys, digits from params).
  basicShapeFace: "param",
  sinCosFace: "param",
  sinCos4Face: "param",
  softwaveOscFace: "param",
  rgbShapeFace: "param",
  textBoxFace: "param",
  slewShapeFace: "param",
  additiveFilterCurve: "param",
  additiveWaveform: "param",
  additiveBlasterBlocks: "param",
  additiveBubbleCascade: "param",
  harmonicCount: "param",
  harmonicLines: "param",
  harmonicSeriesFace: "param",
  arpKeysFace: "param",
  phoneToneFace: "param",
  transportBpm: "param",
  // Controllers and sample pictures (UI / param, never engine-gated).
  knobFace: "param",
  keyboardControllerFace: "param",
  momentaryButtonFace: "param",
  toggleButtonFace: "param",
  pluginSliderFace: "param",
  roundShapeFace: "param",
  sampleWaveform: "param",
  // Node types whose faces are UI or param pictures.
  audioPlayer: "param",
  wavetable2d: "param",
  sequencer: "param",
  ellipsoid: "param",
  basicShape: "param",
  sinCos: "param",
  softwaveOsc: "param",
  slewLimiter: "param",
});

const NODE_GRAPH_CURVE_FACE_SELECTOR = [
  ".node-filter-curve-display",
  ".node-filter-curve-canvas",
  ".node-envelope-curve-display",
  ".node-round-shape-display",
  ".node-basic-shape-display",
  ".node-sincos4-display",
  ".node-pulse-curve-display",
  ".node-soft-clipper-curve-display",
].join(", ");

function nodeGraphFacePaintIsCurveFace(el) {
  if (typeof nodeGraphFilterCurveIsPersistentScreen === "function" && nodeGraphFilterCurveIsPersistentScreen(el)) {
    return true;
  }
  try {
    return Boolean(el.matches?.(NODE_GRAPH_CURVE_FACE_SELECTOR) || el.closest?.(NODE_GRAPH_CURVE_FACE_SELECTOR)
      || el.querySelector?.(NODE_GRAPH_CURVE_FACE_SELECTOR));
  } catch (_e) {
    return false;
  }
}

function nodeGraphRegisterFacePaintKind(key, kind) {
  const k = String(key || "").trim();
  if (!k || !NODE_GRAPH_FACE_PAINT_KINDS.includes(kind)) {
    return;
  }
  nodeGraphFacePaintKindTable[k] = kind;
}

function nodeGraphDeclareFacePaintKind(element, kind) {
  if (!element?.dataset || !NODE_GRAPH_FACE_PAINT_KINDS.includes(kind)) {
    return;
  }
  element.dataset.facePaint = kind;
}

/**
 * Paint kind for a slot, face element, node id, or renderer key.
 * Order: element data-face-paint, display renderer, node type, then "buffer".
 */
function nodeGraphFacePaintKindFor(target) {
  if (!target) {
    return "buffer";
  }
  if (typeof target === "string") {
    const direct = nodeGraphFacePaintKindTable[target];
    if (direct) return direct;
    const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(target) : null;
    return (node?.type && nodeGraphFacePaintKindTable[node.type]) || "buffer";
  }
  const el = target.scopeElement || (target.dataset ? target : null);
  const declared = el?.dataset?.facePaint
    || el?.closest?.("[data-face-paint]")?.dataset?.facePaint;
  if (NODE_GRAPH_FACE_PAINT_KINDS.includes(declared)) {
    return declared;
  }
  // Filter / envelope / shape / clipper curve faces (eqFilter, passiveFilter,
  // cookbook filters, envelopes, pulse curve, soft clipper): param pictures.
  if (el && nodeGraphFacePaintIsCurveFace(el)) {
    return "param";
  }
  if (target.scopeElement || target.nodeId) {
    const renderer = typeof nodeGraphModuleDisplayRendererForSlot === "function"
      ? nodeGraphModuleDisplayRendererForSlot(target)
      : "";
    if (renderer && nodeGraphFacePaintKindTable[renderer]) {
      return nodeGraphFacePaintKindTable[renderer];
    }
  }
  const type = target.type
    || el?.dataset?.nodeType
    || el?.closest?.("[data-node-type]")?.dataset?.nodeType
    || "";
  return (type && nodeGraphFacePaintKindTable[type]) || "buffer";
}

/**
 * What a face of this kind does in the given (default: current) engine state.
 *   paint:   draw the face picture now (on create / param change / tick)
 *   black:   show the cold plate instead of a picture
 *   freeze:  hold the last frame; repaint only on explicit force
 *   animate: keep a per-frame loop running (live overlays, sample streams)
 */
function scopePaintFacePolicy(kind, state = scopePaintEngineState()) {
  const k = NODE_GRAPH_FACE_PAINT_KINDS.includes(kind) ? kind : "buffer";
  const playing = state === "playing";
  if (k === "param") {
    return { kind: k, state, paint: true, black: false, freeze: false, animate: playing };
  }
  if (state === "stopped") {
    return { kind: k, state, paint: false, black: true, freeze: false, animate: false };
  }
  if (state === "paused") {
    return { kind: k, state, paint: false, black: false, freeze: true, animate: false };
  }
  return { kind: k, state, paint: true, black: false, freeze: false, animate: true };
}

/**
 * ES-3: shared cold plate for buffer / modulation faces.
 * Stopped: black (registered face wipe if the display type has one, else a
 * plain black fill of the face's existing 2D canvas). Paused: hold the last
 * frame unless force. Param faces are never blanked. Never creates canvases;
 * GL-owned canvases (no 2D context) are left to their own wipe.
 */
const NODE_GRAPH_TRACE_COLD_PLATE_RENDERERS = ["waterfall", "dot", "value", "lineBurn"];

function scopePaintEnsureColdPlate(slot, options = {}) {
  if (!slot) {
    return false;
  }
  const force = options.force === true;
  const nodeId = slot.nodeId || slot.dataset?.node || "";
  const kind = nodeGraphFacePaintKindFor(slot);
  const poweredOff = scopePaintIsFacePoweredOff(nodeId);
  if (kind === "param" && !poweredOff) {
    return false;
  }
  // Stop wipe runs while live.node may still be set: assumeStopped.
  const policy = scopePaintFacePolicy(kind, options.assumeStopped ? "stopped" : undefined);
  if (!poweredOff && !policy.black && !(force && policy.freeze)) {
    return false;
  }
  const face = slot.scopeElement || (slot.dataset ? slot : null);
  const canvas = options.canvas
    || face?.querySelector?.(":scope > canvas.node-module-scope-local-fallback-canvas")
    || face?.querySelector?.("canvas")
    || null;
  if (!canvas || !(canvas.width > 1) || !(canvas.height > 1)) {
    return false;
  }
  const displayType = options.displayType
    || (typeof nodeGraphModuleDisplayRendererForSlot === "function" && slot.scopeElement
      ? nodeGraphModuleDisplayRendererForSlot(slot)
      : "");
  let done = false;
  if (typeof nodeGraphModuleScopeWipeCanvas === "function") {
    done = nodeGraphModuleScopeWipeCanvas(canvas, { nodeId, displayType: displayType || undefined });
  }
  // Trace faces (Instant Waterfall, dot, value, lineBurn, Output): the wipe
  // drops history only; repaint the GL cold plate so no stale trace remains.
  if (
    slot.scopeElement
    && NODE_GRAPH_TRACE_COLD_PLATE_RENDERERS.includes(displayType || "")
    && typeof paintNodeGraphTraceDisplayColdPlate === "function"
  ) {
    const ratio = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
    try {
      done = paintNodeGraphTraceDisplayColdPlate(slot, ratio, { force: true }) || done;
    } catch (_error) {
      // Best-effort.
    }
    return done;
  }
  if (!done && typeof nodeGraphGlLinesFillBlack === "function") {
    nodeGraphGlLinesFillBlack(canvas);
    done = true;
  }
  return done;
}

/** ES-3: cold plate every visible buffer / modulation face (spawn, Stop). */
function scopePaintEnsureColdPlates(options = {}) {
  if (typeof nodeGraphVisibleModuleScopeSlots !== "function") {
    return 0;
  }
  let n = 0;
  for (const slot of nodeGraphVisibleModuleScopeSlots()) {
    if (scopePaintEnsureColdPlate(slot, options)) n += 1;
  }
  return n;
}

/**
 * ES-2: paint every visible param face that draws through the shared scope
 * renderer table, without the live compositor. Called from the stopped /
 * paused branches of the scope draw, so param pictures update in any engine
 * state. Self-painting faces (no-op table entries) keep their own pumps.
 */
function paintNodeGraphParamFacesNow(pixelRatio) {
  if (
    typeof nodeGraphVisibleModuleScopeSlots !== "function"
    || typeof nodeGraphModuleScopeCustomRenderers !== "object"
    || !nodeGraphModuleScopeCustomRenderers
  ) {
    return 0;
  }
  const ratio = Number(pixelRatio) > 0
    ? Number(pixelRatio)
    : (typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1);
  let painted = 0;
  for (const slot of nodeGraphVisibleModuleScopeSlots()) {
    if (nodeGraphFacePaintKindFor(slot) !== "param") {
      continue;
    }
    if (scopePaintIsFacePoweredOff(slot?.nodeId)) {
      continue;
    }
    const key = typeof nodeGraphModuleDisplayRendererForSlot === "function"
      ? nodeGraphModuleDisplayRendererForSlot(slot)
      : "";
    const draw = key ? nodeGraphModuleScopeCustomRenderers[key] : null;
    if (typeof draw !== "function" || draw.length === 0) {
      continue;
    }
    try {
      draw(null, { slot, screenElement: slot.scopeElement }, ratio);
      painted += 1;
    } catch (error) {
      console.error("param face paint failed", key, error);
    }
  }
  return painted;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    paintNodeGraphParamFacesNow,
    scopePaintEnsureColdPlate,
    scopePaintEnsureColdPlates,
    scopePaintEngineState,
    scopePaintFacePolicy,
    nodeGraphFacePaintKindFor,
    nodeGraphRegisterFacePaintKind,
    nodeGraphDeclareFacePaintKind,
  };
}
