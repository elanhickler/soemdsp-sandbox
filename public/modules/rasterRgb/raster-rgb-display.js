// Raster RGB — one analog sample is one pixel. Rolling W×H grid on the GPU
// (raster-rgb-gl.js): only new samples are uploaded; the beam writes run in a
// shader. Channel brightness = clamp(|v|, 0, 1) (unipolar, rectified).
// paint-rev syntax-3: file must parse (no ?? mixed with ||).
// Display Settings → Square ratio screen: on = uniform contain (square
// pixels); off (default) = stretch to the face. 0×N / N×0 draws nothing.
// Contrast / brightness / invert / hue are a LUT on the raster
// (S-curve, not CSS contrast() which clips). Blur / glow are the
// original canvas Gaussian: filter:blur() on the present, then an
// additive wider Gaussian for glow.

const NODE_GRAPH_RASTER_RGB_PAINT_REV = "gpu-beam-3-sync";

// Grid state (GPU texture + beam phase) lives by node id — not on the face canvas.
// Hide/show title rebuilds the module DOM; the raster must survive that.
const nodeGraphRasterRgbBuffers = new Map();

const nodeGraphRasterRgbSettingsDefaults = Object.freeze({
  background: "#000000",
  squareRatio: false,
  // edgeSpacing / cornerRadius: 0..1 of maxInset / maxRadius (Music Player §15).
  edgeSpacing: 0,
  cornerRadius: 0,
  cornerShape: "square",
});

function normalizeNodeGraphRasterRgbSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const background = typeof normalizeNodeGraphTraceDisplayColor === "function"
    ? normalizeNodeGraphTraceDisplayColor(source.background ?? source.backgroundColor, "#000000")
    : String(source.background || "#000000");
  const squareRaw = source.squareRatio;
  const squareRatio = squareRaw === true || squareRaw === 1 || squareRaw === "true" || squareRaw === "1";
  const edgeSpacing = Number(source.edgeSpacing);
  const cornerRadius = Number(source.cornerRadius);
  const cornerShape = source.cornerShape === "squircle" ? "squircle" : "square";
  return {
    background,
    // Alias for Display Settings color widgets (data-trace-display-color=backgroundColor).
    backgroundColor: background,
    squareRatio,
    edgeSpacing: Number.isFinite(edgeSpacing)
      ? clampDisplayUnit01(edgeSpacing, nodeGraphRasterRgbSettingsDefaults.edgeSpacing)
      : nodeGraphRasterRgbSettingsDefaults.edgeSpacing,
    cornerRadius: Number.isFinite(cornerRadius)
      ? clampDisplayUnit01(cornerRadius, nodeGraphRasterRgbSettingsDefaults.cornerRadius)
      : nodeGraphRasterRgbSettingsDefaults.cornerRadius,
    cornerShape,
  };
}

function nodeGraphRasterRgbApplyScreenChrome(face, canvas, settings) {
  if (!face?.style) {
    return;
  }
  const cellW = face.offsetWidth || 0;
  const cellH = face.offsetHeight || 0;
  const maxInset = Math.max(0, Math.min(cellW, cellH) / 2);
  const inset = Math.round(nodeGraphFiniteNumber(settings.edgeSpacing) * maxInset);
  const panelW = Math.max(0, cellW - inset * 2);
  const panelH = Math.max(0, cellH - inset * 2);
  const maxRadius = Math.max(0, Math.min(panelW, panelH) / 2);
  const radius = Math.round(nodeGraphFiniteNumber(settings.cornerRadius) * maxRadius);
  const shape = settings.cornerShape === "squircle" ? "squircle" : "round";
  face.dataset.rasterRgbScreen = "true";
  face.style.setProperty("--raster-rgb-inset", `${inset}px`);
  face.style.setProperty("--raster-rgb-radius", `${radius}px`);
  face.style.setProperty("--raster-rgb-corner-shape", shape);
  if (canvas?.style) {
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.borderRadius = `${radius}px`;
    canvas.style.cornerShape = shape;
  }
}

function nodeGraphRasterRgbSettingsForNode(node) {
  return normalizeNodeGraphRasterRgbSettings(node?.traceDisplaySettings);
}

/** Logical (fractional) grid axis — 0 hides; otherwise keep the exact param. */
function nodeGraphRasterRgbDim(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const fb = Number(fallback);
    return Number.isFinite(fb) && fb > 0 ? fb : 0;
  }
  return n > 0 ? n : 0;
}

/**
 * Integer storage size for a logical axis.
 * ceil so fractional Width (e.g. 96.3) still has a column for the partial step;
 * write mapping uses the exact logical period so high-rate RGB can line up.
 */
function nodeGraphRasterRgbBufferDim(logical) {
  const n = Number(logical);
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(n - 1e-12));
}

function nodeGraphRasterRgbPosMod(pos, period) {
  const p = Number(period);
  if (!(p > 0)) {
    return 0;
  }
  const n = nodeGraphFiniteNumber(pos);
  const m = n % p;
  return m < 0 ? m + p : m;
}

function nodeGraphRasterRgbGridSize(node) {
  const params = node?.params || {};
  const width = nodeGraphRasterRgbDim(params.width, 96);
  const height = nodeGraphRasterRgbDim(params.height, 54);
  return {
    width,
    height,
    bufferWidth: nodeGraphRasterRgbBufferDim(width),
    bufferHeight: nodeGraphRasterRgbBufferDim(height),
  };
}

/** Pixels advanced per ingested audio sample (1 = sample clock; fractional OK). */
function nodeGraphRasterRgbScanSpeed(node) {
  const raw = Number(node?.params?.scanSpeed);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 8;
  }
  return SoemMath.clamp(raw, 0.05, 64);
}

function nodeGraphRasterRgbUnit01(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return SoemMath.clamp01(n);
}

function nodeGraphRasterRgbHueParam(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  if (typeof nodeGraphRasterRgbWrapHue === "function") {
    return nodeGraphRasterRgbWrapHue(n);
  }
  return ((n % 1) + 1) % 1;
}

function nodeGraphRasterRgbGrade(node) {
  const params = node?.params && typeof node.params === "object" ? node.params : {};
  const invert = nodeGraphRasterRgbUnit01(params.invert, 0);
  const contrastRaw = Number(params.contrast);
  const brightnessRaw = Number(params.brightness);
  const contrast = Number.isFinite(contrastRaw) ? SoemMath.clamp(contrastRaw, -4, 4) : 1;
  const brightness = Number.isFinite(brightnessRaw) ? SoemMath.clamp(brightnessRaw, -4, 4) : 1;
  const blur = nodeGraphRasterRgbUnit01(params.blur, 0);
  const glow = nodeGraphRasterRgbUnit01(params.glow, 0);
  return {
    invert,
    contrast: Number.isFinite(contrast) ? contrast : 1,
    brightness: Number.isFinite(brightness) ? brightness : 1,
    hue: nodeGraphRasterRgbHueParam(params.hue),
    blur,
    glow,
  };
}

/** Power S-curve. 1 = identity, 0 = mid grey, >1 = steeper mids, <0 = inverted. */
function nodeGraphRasterRgbContrastCurve(x, contrast) {
  if (typeof nodeGraphRasterRgbContrast01 === "function") {
    return nodeGraphRasterRgbContrast01(x, contrast);
  }
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  const c = Number(contrast);
  if (!Number.isFinite(c) || c === 0) {
    return 0.5;
  }
  const mag = Math.abs(c);
  let y = t;
  if (Math.abs(mag - 1) >= 1e-4) {
    y = t < 0.5
      ? 0.5 * (2 * t) ** mag
      : 1 - 0.5 * (2 * (1 - t)) ** mag;
  }
  return c < 0 ? 1 - y : y;
}

function nodeGraphRasterRgbParseHexRgb(value, fallback = "#000000") {
  const raw = String(value || fallback || "#000000").trim();
  const hex = raw[0] === "#" ? raw.slice(1) : raw;
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    if ([r, g, b].every((n) => Number.isFinite(n))) {
      return [r, g, b];
    }
  }
  if (hex.length >= 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if ([r, g, b].every((n) => Number.isFinite(n))) {
      return [r, g, b];
    }
  }
  return [0, 0, 0];
}

/** Photographic invert of a plate color. invert=1 turns black into white. */
function nodeGraphRasterRgbInvertCssColor(value, invert) {
  const a = nodeGraphRasterRgbUnit01(invert, 0);
  const [r, g, b] = nodeGraphRasterRgbParseHexRgb(value, "#000000");
  if (!(a > 0)) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgb(${Math.round(r + a * (255 - 2 * r))}, ${Math.round(g + a * (255 - 2 * g))}, ${Math.round(b + a * (255 - 2 * b))})`;
}

function nodeGraphRasterRgbGradeLut(grade) {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) {
    const x = typeof nodeGraphRasterRgbGradeChannel01 === "function"
      ? nodeGraphRasterRgbGradeChannel01(i / 255, grade)
      : nodeGraphRasterRgbContrastCurve(i / 255, grade?.contrast);
    lut[i] = x <= 0 ? 0 : x >= 1 ? 255 : Math.round(x * 255);
  }
  return lut;
}

function nodeGraphRasterRgbState(nodeId, width, height, logicalWidth = width, logicalHeight = height) {
  const key = String(nodeId || "");
  let state = key ? nodeGraphRasterRgbBuffers.get(key) : null;
  const lw = Math.max(1e-9, nodeGraphFiniteNumber(logicalWidth, width));
  const lh = Math.max(1e-9, nodeGraphFiniteNumber(logicalHeight, height));
  if (!state || state.width !== width || state.height !== height) {
    nodeGraphRasterRgbGlFree(state);
    state = {
      height,
      logicalHeight: lh,
      logicalWidth: lw,
      width,
      // Continuous sample index — X wraps every logicalWidth (fractional OK).
      writePos: 0,
      // GPU grid (raster-rgb-gl.js gridFor), created opaque black on first use.
      gpu: null,
      // H / V Sync trigger state (last sample out of Planck silence).
      syncOn: { h: false, v: false },
    };
    if (key) {
      nodeGraphRasterRgbBuffers.set(key, state);
    }
  } else if (
    Math.abs((nodeGraphFiniteNumber(state.logicalWidth)) - lw) > 1e-9
    || Math.abs((nodeGraphFiniteNumber(state.logicalHeight)) - lh) > 1e-9
  ) {
    // Same ceil buffer, new line period — retune without wiping the plate.
    state.logicalWidth = lw;
    state.logicalHeight = lh;
  }
  return state;
}

function nodeGraphRasterRgbDropState(nodeId) {
  const key = String(nodeId || "");
  if (key) {
    nodeGraphRasterRgbBuffers.delete(key);
  }
}

function nodeGraphRasterRgbCircuitRunning() {
  if (typeof nodeGraphModuleScopeCircuitRunning === "function") {
    return nodeGraphModuleScopeCircuitRunning();
  }
  const live = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.live : null;
  return Boolean(live?.outputEnabled && live?.node);
}

function nodeGraphRasterRgbRingAbsEnd(ring) {
  if (!ring) {
    return Number.NaN;
  }
  if (typeof nodeGraphScopeBufferAbsoluteFrame === "function") {
    const n = nodeGraphScopeBufferAbsoluteFrame(ring);
    if (n > 0) {
      return n;
    }
  }
  const abs = Number(ring.nodeGraphScopeAbsoluteFrame);
  if (Number.isFinite(abs) && abs > 0) {
    return abs;
  }
  const total = Number(ring.nodeGraphScopeTotalSampleCount);
  return Number.isFinite(total) && total > 0 ? total : Number.NaN;
}

function nodeGraphRasterRgbClearState(state) {
  if (!state) {
    return;
  }
  nodeGraphRasterRgbGlFree(state);
  state.write = 0;
  state.writePos = 0;
  state.lastAbs = Number.NaN;
  state.scanCredit = 0;
  state.syncOn = { h: false, v: false };
}

/** Display Settings Clear — wipe the rolling plate and re-arm ingest phase. */
function clearNodeGraphRasterRgbForNode(nodeId) {
  const key = String(nodeId || "");
  if (!key) {
    return false;
  }
  const state = nodeGraphRasterRgbBuffers.get(key);
  if (state) {
    nodeGraphRasterRgbClearState(state);
  }
  nodeGraphRasterRgbDropState(key);
  if (typeof document !== "undefined") {
    const faces = document.querySelectorAll(
      `.dsp-node[data-node="${key}"] .node-module-scope-window, .node-module-scope-window[data-node="${key}"]`,
    );
    for (const face of faces) {
      const canvas = face.querySelector?.(":scope > .node-raster-rgb-canvas");
      if (canvas) {
        canvas._rasterRgb = null;
        canvas._rasterRgbBlit = false;
        canvas._rasterRgbGradeKey = "";
        canvas._rasterRgbHoldKey = "";
        nodeGraphFacePlateFillCanvas(null, canvas, "#000000");
      }
    }
  }
  return true;
}

function nodeGraphRasterRgbUnlightFace(face) {
  if (face?.dataset) {
    face.dataset.lightStrength = "0";
  }
  const canvas = face?.querySelector?.(":scope > .node-raster-rgb-canvas");
  if (canvas?.dataset) {
    canvas.dataset.lightStrength = "0";
  }
  if (typeof setNodeGraphLightStrength === "function" && face) {
    try {
      setNodeGraphLightStrength(face, 0);
    } catch (_error) {
      // Best-effort.
    }
  }
}

function wipeNodeGraphRasterRgbScreensToColdBoot(options = {}) {
  if (typeof document === "undefined") {
    return;
  }
  const onlyId = String(options.nodeId || "").trim();
  const faces = typeof nodeGraphRasterRgbCollectFaces === "function"
    ? nodeGraphRasterRgbCollectFaces()
    : [];
  const seen = new Set();
  const list = faces.length
    ? faces.map((entry) => entry.face).filter(Boolean)
    : Array.from(document.querySelectorAll(
      "[data-node-type=\"rasterRgb\"] .node-module-scope-window, .node-module-scope-window[data-node-type=\"rasterRgb\"]",
    ));
  for (const face of list) {
    if (!face || seen.has(face)) {
      continue;
    }
    seen.add(face);
    const canvas = options.canvas
      || face.querySelector?.(":scope > .node-raster-rgb-canvas");
    const nodeId = face.dataset?.node
      || face.closest?.("[data-node]")?.dataset?.node
      || "";
    if (onlyId && nodeId !== onlyId) {
      continue;
    }
    const state = (nodeId && nodeGraphRasterRgbBuffers.get(String(nodeId)))
      || canvas?._rasterRgb;
    if (state) {
      nodeGraphRasterRgbClearState(state);
    }
    if (nodeId) {
      nodeGraphRasterRgbDropState(nodeId);
    }
    if (canvas) {
      canvas._rasterRgb = null;
      canvas._rasterRgbBlit = false;
      canvas._rasterRgbGradeKey = "";
    }
    if (canvas) {
      nodeGraphFacePlateFillCanvas(null, canvas, "#000000");
    }
    if (face.style) {
      face.style.background = "#000000";
    }
    nodeGraphRasterRgbUnlightFace(face);
  }
  if (!onlyId) {
    nodeGraphRasterRgbBuffers.clear();
  }
}

const NODE_GRAPH_RASTER_RGB_SYNC_PORTS = [["H Sync", "h"], ["V Sync", "v"]];

/**
 * H / V Sync hits in this frame's window, sorted: [{ at, kind }], `at` = index
 * into the newest `take` samples (the beam moves before that sample writes).
 * Trigger rule (docs/GATES_TRIGGERS.md): a hit is leaving Planck silence in
 * either sign, |last| < Planck <= |now|. Only for a wired sync input; this is
 * a scan of the sync ring for edges, no pixel work (the beam stays on the GPU).
 */
function nodeGraphRasterRgbSyncHits(state, slot, take) {
  const hits = [];
  const nodeId = slot?.nodeId;
  const planck = nodeGraphPlanck();
  state.syncOn ||= { h: false, v: false };
  for (const [port, kind] of NODE_GRAPH_RASTER_RGB_SYNC_PORTS) {
    const wired = typeof nodeGraphModuleScopeConnectionsTo === "function"
      && (nodeGraphModuleScopeConnectionsTo(nodeId, port) || []).length > 0;
    if (!wired) {
      state.syncOn[kind] = false;
      continue;
    }
    const tail = nodeGraphRasterRgbRingTail(nodeGraphRasterRgbPickChannel(slot, port), take);
    if (!tail) {
      continue;
    }
    const offset = take - tail.length;
    let on = state.syncOn[kind];
    for (let i = 0; i < tail.length; i += 1) {
      const now = Math.abs(tail[i]) >= planck;
      if (now && !on) {
        hits.push({ at: offset + i, kind });
      }
      on = now;
    }
    state.syncOn[kind] = on;
  }
  if (hits.length > 1) {
    hits.sort((a, b) => a.at - b.at);
  }
  return hits;
}

/** The newest `take` samples of a ring as a Float32Array view (no copy). */
function nodeGraphRasterRgbRingTail(ring, take) {
  if (!ring?.length || !(take > 0)) {
    return null;
  }
  const start = Math.max(0, ring.length - take);
  return ring instanceof Float32Array
    ? ring.subarray(start)
    : Float32Array.from(Array.prototype.slice.call(ring, start));
}

function nodeGraphRasterRgbBufferFromKey(nodeId, port) {
  const state = typeof nodeGraphModuleScopeState === "object" ? nodeGraphModuleScopeState : null;
  if (!state?.buffers || !nodeId) {
    return null;
  }
  const names = [port, String(port).toLowerCase(), String(port).toUpperCase()];
  for (const name of names) {
    const ring = state.buffers.get(`${nodeId}:${name}`);
    if (ring?.length) {
      return ring;
    }
  }
  return null;
}

function nodeGraphRasterRgbRingLooksAudioRate(ring) {
  if (!ring?.length) {
    return false;
  }
  const stride = Number(ring.nodeGraphScopeSampleStride);
  if (Number.isFinite(stride) && stride > 1.5) {
    return false;
  }
  const hz = Number(ring.nodeGraphScopeSampleRate);
  // LCD / Simulation-FPS rings sit near 30–120 Hz; audio rings are kHz+.
  if (Number.isFinite(hz) && hz > 0 && hz < 1000) {
    return false;
  }
  return true;
}

function nodeGraphRasterRgbPickChannel(slot, port) {
  const nodeId = slot?.nodeId;
  // 1) Own visual-sink inlet ring first — worklet writes wired audio here at
  //    engine rate. Upstream face rings (e.g. SinCos4) are often LCD-rate and
  //    made the plate crawl (~60 px/s) when preferred.
  const inlet = nodeGraphRasterRgbBufferFromKey(nodeId, port);
  if (inlet?.length && nodeGraphRasterRgbRingLooksAudioRate(inlet)) {
    return inlet;
  }
  // 2) Upstream face-capture rings only when they look like audio (or inlet empty).
  const conns = typeof nodeGraphModuleScopeConnectionsTo === "function"
    ? nodeGraphModuleScopeConnectionsTo(nodeId, port)
    : [];
  let upstreamFallback = null;
  for (const connection of conns || []) {
    const ring = nodeGraphRasterRgbBufferFromKey(connection.sourceNode, connection.sourcePort);
    if (!ring?.length) {
      continue;
    }
    if (nodeGraphRasterRgbRingLooksAudioRate(ring)) {
      return ring;
    }
    if (!upstreamFallback) {
      upstreamFallback = ring;
    }
  }
  if (typeof nodeGraphModuleScopeConnectedSourceBuffer === "function") {
    const connected = nodeGraphModuleScopeConnectedSourceBuffer(nodeId, port);
    if (connected?.length && nodeGraphRasterRgbRingLooksAudioRate(connected)) {
      return connected;
    }
    if (!upstreamFallback && connected?.length) {
      upstreamFallback = connected;
    }
  }
  if (inlet?.length) {
    return inlet;
  }
  return upstreamFallback;
}

function nodeGraphRasterRgbWiredPicture(slot) {
  const nodeId = slot?.nodeId;
  if (!nodeId) return null;
  if (typeof nodeGraphPictureRead !== "function") return null;
  // Edge table (VG-1): rgba / 📺 first, then any picture source cabled to R/G/B.
  const ports = ["rgba", "📺", "R", "G", "B"];
  for (let i = 0; i < ports.length; i += 1) {
    const pic = nodeGraphPictureRead(nodeId, ports[i]);
    if (pic?.texture) return pic;
  }
  return null;
}

function nodeGraphRasterRgbTakeChannels(slot) {
  const rings = {
    R: nodeGraphRasterRgbPickChannel(slot, "R"),
    G: nodeGraphRasterRgbPickChannel(slot, "G"),
    B: nodeGraphRasterRgbPickChannel(slot, "B"),
  };
  const lengths = ["R", "G", "B"].map((port) => {
    const ring = rings[port];
    if (!ring?.length) {
      return 0;
    }
    if (typeof nodeGraphScopeAvailableSampleCount === "function") {
      return nodeGraphScopeAvailableSampleCount(ring) || ring.length;
    }
    return ring.length;
  });
  const frames = Math.max(0, ...lengths);
  return { length: frames, R: rings.R, G: rings.G, B: rings.B };
}

function nodeGraphRasterRgbEnsureCanvas(face, slot, pixelRatio) {
  // Own canvas. The shared fallback plate is cleared/wiped by Trace/stop
  // and sat on top of this face — Raster never survived that.
  if (face) {
    for (const leftover of face.querySelectorAll(":scope > .node-module-scope-local-fallback-canvas")) {
      leftover.remove();
    }
  }
  let canvas = face.querySelector(":scope > .node-raster-rgb-canvas");
  if (!canvas) {
    canvas = nodeGraphDisplayCanvasCreate("node-raster-rgb-canvas");
    canvas.setAttribute("aria-hidden", "true");
    face.appendChild(canvas);
  }
  const cssW = Math.max(1, face.clientWidth || face.offsetWidth || 1);
  const cssH = Math.max(1, face.clientHeight || face.offsetHeight || 1);
  const dpr = Math.max(1, nodeGraphFiniteNumber(pixelRatio, nodeGraphDisplayCanvasPixelRatio()));
  const bw = Math.max(1, Math.round(cssW * dpr));
  const bh = Math.max(1, Math.round(cssH * dpr));
  nodeGraphDisplayCanvasSetBacking(canvas, bw, bh);
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.zIndex = "5";
  canvas.style.mixBlendMode = "normal";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "none";
  return canvas;
}

function nodeGraphRasterRgbApplyPlate(face, plate) {
  if (!face) {
    return;
  }
  if (typeof nodeGraphFacePlateApplyCss === "function") {
    nodeGraphFacePlateApplyCss(face, plate);
  }
  if (face.style) {
    face.style.background = plate;
    face.style.setProperty("--node-scope-background", plate);
  }
  const surface = face.querySelector(":scope > .node-module-scope-window-surface");
  if (surface?.style) {
    surface.style.background = plate;
    surface.style.zIndex = "0";
  }
  if (face.dataset) {
    face.dataset.lightSource = "screen";
    face.dataset.lightStrength = "1";
  }
  if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
    nodeGraphModuleScopeMarkScreenLit(face, 1);
  }
}

function drawNodeGraphRasterRgbFaceItem(_renderer, item, pixelRatio) {
  const slot = item?.slot || null;
  const face = item?.screenElement || slot?.scopeElement;
  if (!face) {
    return;
  }
  const nodeId = slot?.nodeId || face.dataset?.node || item?.nodeId;
  // Face off screen but a visible sink reads the 📺 out: scan and publish,
  // skip the face present.
  const asleep = Boolean(item?.asleep);
  const node = (typeof nodeGraphModuleScopeNodeForSlot === "function" && slot
    ? nodeGraphModuleScopeNodeForSlot(slot)
    : null)
    || (typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null);
  const settings = nodeGraphRasterRgbSettingsForNode(node);
  const grade = nodeGraphRasterRgbGrade(node);
  const plate = nodeGraphRasterRgbInvertCssColor(settings.background, grade.invert);
  const running = nodeGraphRasterRgbCircuitRunning();
  if (running) {
    nodeGraphRasterRgbApplyPlate(face, plate);
  } else {
    if (face.style) {
      face.style.background = plate;
    }
    nodeGraphRasterRgbUnlightFace(face);
  }
  const paintSlot = slot || { nodeId, scopeElement: face, type: "rasterRgb" };
  const canvas = nodeGraphRasterRgbEnsureCanvas(face, paintSlot, pixelRatio);
  canvas.style.background = plate;
  const ctx = nodeGraphDisplayCanvasPresentContext(canvas);
  if (!ctx) {
    return;
  }
  const grid = nodeGraphRasterRgbGridSize(node);
  const cw = canvas.width;
  const ch = canvas.height;
  if (!asleep) nodeGraphRasterRgbApplyScreenChrome(face, canvas, settings);
  const frozen = (typeof scopePaintIsFrozen === "function" && scopePaintIsFrozen())
    || (typeof nodeGraphModuleScopePhosphorFrozen === "function"
      && nodeGraphModuleScopePhosphorFrozen());
  const bufW = grid.bufferWidth || 0;
  const bufH = grid.bufferHeight || 0;
  const sizeKey = `${cw}x${ch}|${grid.width}x${grid.height}|${bufW}x${bufH}`;
  // Pause/speed 0: hold the paused picture (a feature, not a GL fallback). Do not fill-wipe then early-return
  // (that left a blank plate while the pixel buffer still existed).
  if (frozen && canvas._rasterRgbBlit && canvas._rasterRgbHoldKey === sizeKey) {
    return;
  }
  // Plate through the shared GL device; the graded picture is blitted over it.
  ctx.filter = "none";
  const plateFill = asleep ? "ok" : nodeGraphFacePlateFill(canvas, plate);
  if (plateFill !== "ok") {
    nodeGraphDisplayGlFailed(canvas, "raster RGB plate: GL " + plateFill);
    return;
  }
  if (!running && !frozen) {
    const held = nodeGraphRasterRgbBuffers.get(String(nodeId || ""));
    if (held) {
      nodeGraphRasterRgbClearState(held);
    }
    nodeGraphRasterRgbDropState(nodeId);
    canvas._rasterRgb = null;
    canvas._rasterRgbBlit = false;
    canvas._rasterRgbGradeKey = "";
    canvas._rasterRgbHoldKey = "";
    return;
  }
  if (!(grid.width > 0) || !(grid.height > 0) || !(bufW > 0) || !(bufH > 0)) {
    canvas._rasterRgbBlit = true;
    canvas._rasterRgbHoldKey = sizeKey;
    return;
  }
  let state;
  try {
    state = nodeGraphRasterRgbState(nodeId, bufW, bufH, grid.width, grid.height);
    canvas._rasterRgb = state;
  } catch (_err) {
    canvas._rasterRgbBlit = true;
    canvas._rasterRgbHoldKey = sizeKey;
    return;
  }
  const captured = nodeGraphRasterRgbTakeChannels(paintSlot);
  const cellCount = state.width * state.height;
  const wired = Boolean(captured.length);
  const logicalW = Math.max(1e-9, nodeGraphFiniteNumber(state.logicalWidth, grid.width) || state.width);
  const logicalH = Math.max(1e-9, nodeGraphFiniteNumber(state.logicalHeight, grid.height) || state.height);
  const frameSamples = logicalW * logicalH;
  // New pixels only when the shared Simulation FPS tick arms ingest.
  // Extra paints (pump, collect, slider) re-present grade without a second write.
  if (wired && cellCount > 0 && !frozen && nodeGraphRasterRgbShouldIngest()) {
    const red = captured.R;
    const green = captured.G;
    const blue = captured.B;
    const primary = red?.length ? red : (green?.length ? green : blue);
    const absEnd = nodeGraphRasterRgbRingAbsEnd(primary);
    const oneFrame = Math.max(1, Math.ceil(frameSamples));
    let lastAbs = Number(state.lastAbs);
    // Cold start / after Clear: skip ring backlog so project open does not
    // dump half a second of history (misaligned until Width/Height retune).
    if (!Number.isFinite(lastAbs) || lastAbs < 0) {
      lastAbs = Number.isFinite(absEnd)
        ? Math.max(0, Math.floor(absEnd) - oneFrame)
        : 0;
      state.writePos = 0;
    }
    let undrawn = Number.isFinite(absEnd)
      ? Math.max(0, Math.floor(absEnd) - Math.floor(lastAbs))
      : 0;
    if (!(undrawn > 0) && !Number.isFinite(absEnd)) {
      const recent = Math.max(
        0,
        Math.floor(nodeGraphFiniteNumber(primary?.nodeGraphScopeRecentSampleCount)),
      );
      undrawn = recent > 0 ? recent : Math.min(captured.length, oneFrame);
    }
    // Every undrawn sample since the last paint (a stall included). The only
    // bound is the ring itself: older samples are no longer there to draw.
    const take = Math.min(undrawn, captured.length);
    // Beam on the GPU (raster-rgb-gl.js): Scan Speed pixels per sample
    // (fractional credit carried over), x = pos mod W, y = floor(pos / W) mod H.
    const scanned = nodeGraphRasterRgbGlScan(state, {
      take,
      channels: [
        nodeGraphRasterRgbRingTail(red, take),
        nodeGraphRasterRgbRingTail(green, take),
        nodeGraphRasterRgbRingTail(blue, take),
      ],
      logicalW,
      logicalH,
      speed: nodeGraphRasterRgbScanSpeed(node),
      syncs: nodeGraphRasterRgbSyncHits(state, paintSlot, take),
    });
    if (!scanned) {
      canvas._rasterRgbBlit = false;
      nodeGraphDisplayGlFailed(canvas, "Scan Grid GL beam failed");
      return;
    }
    state.lastAbs = Number.isFinite(absEnd)
      ? Math.floor(absEnd)
      : Math.floor(lastAbs) + take;
  }
  const gradeKey = `${grade.invert}|${grade.contrast}|${grade.brightness}|${grade.hue}|${grade.blur}|${grade.glow}|${grid.width}x${grid.height}|${bufW}x${bufH}|${wired ? captured.length : 0}`;
  nodeGraphDisplayCanvasPixelated(canvas, true);
  let dw = cw;
  let dh = ch;
  let dx = 0;
  let dy = 0;
  if (settings.squareRatio) {
    // Logical (fractional) size drives on-screen cell size so fine Width/Height
    // nudges are visible between whole-pixel buffer snaps.
    const scale = Math.min(cw / grid.width, ch / grid.height);
    dw = Math.max(1, Math.floor(grid.width * scale));
    dh = Math.max(1, Math.floor(grid.height * scale));
    dx = Math.floor((cw - dw) * 0.5);
    dy = Math.floor((ch - dh) * 0.5);
  }
  const span = Math.max(2, Math.min(dw, dh));
  const blurPx = grade.blur * span * 0.045;
  const glowPx = Math.max(blurPx, grade.glow * span * 0.07) * 1.6;
  // GPU first (DISPLAY_SHADER_PLAN M3, raster-rgb-gl.js): raw buffer texture,
  // grade LUT + hue + separable blur / glow in shaders on the shared picture
  // device. No fallback: a failed GPU frame is black + logged.
  const pic = nodeGraphRasterRgbWiredPicture(paintSlot);
  // 📺 out: the graded grid at grid resolution, only while a cable reads it
  // (pull-based: the video graph keeps this node needed through that cable).
  if (nodeGraphPictureHasConsumer(nodeId)) {
    const exported = nodeGraphRasterRgbGlExport(nodeId, state, grade, {
      sourceTex: pic?.texture || null,
      sourceW: pic?.width || 0,
      sourceH: pic?.height || 0,
    });
    if (!exported) {
      canvas._rasterRgbBlit = false;
      nodeGraphDisplayGlFailed(canvas, "Scan Grid 📺 export failed");
      return;
    }
  }
  if (asleep) {
    return;
  }
  const gpuDrawn = typeof nodeGraphRasterRgbGlPresent === "function"
    && nodeGraphRasterRgbGlPresent(state, grade, ctx, {
      cw, ch, dx, dy, dw, dh, blurPx, glowPx, plate,
      sourceTex: pic?.texture || null,
      sourceW: pic?.width || 0,
      sourceH: pic?.height || 0,
    });
  if (!gpuDrawn) {
    canvas._rasterRgbBlit = false;
    nodeGraphDisplayGlFailed(canvas, "Raster RGB GL present failed");
    return;
  }
  canvas._rasterRgbBlit = true;
  canvas._rasterRgbGradeKey = gradeKey;
  canvas._rasterRgbHoldKey = sizeKey;
  canvas._rasterRgbDebug = {
    nodeId,
    renderer: typeof nodeGraphModuleDisplayRendererForSlot === "function"
      ? nodeGraphModuleDisplayRendererForSlot(paintSlot)
      : "",
    type: paintSlot.type || "",
    faceCss: `${face.clientWidth || 0}x${face.clientHeight || 0}`,
    canvasPx: `${cw}x${ch}`,
    grid: `${grid.width}x${grid.height}`,
    invert: grade.invert,
    wired,
    take: wired ? Math.min(captured.length, cellCount) : 0,
    rings: {
      R: captured.R?.length || 0,
      G: captured.G?.length || 0,
      B: captured.B?.length || 0,
    },
    wires: {
      R: typeof nodeGraphModuleScopeConnectionsTo === "function"
        ? (nodeGraphModuleScopeConnectionsTo(nodeId, "R") || []).map((c) => `${c.sourceNode}.${c.sourcePort}`)
        : [],
      G: typeof nodeGraphModuleScopeConnectionsTo === "function"
        ? (nodeGraphModuleScopeConnectionsTo(nodeId, "G") || []).map((c) => `${c.sourceNode}.${c.sourcePort}`)
        : [],
      B: typeof nodeGraphModuleScopeConnectionsTo === "function"
        ? (nodeGraphModuleScopeConnectionsTo(nodeId, "B") || []).map((c) => `${c.sourceNode}.${c.sourcePort}`)
        : [],
    },
    paintRev: NODE_GRAPH_RASTER_RGB_PAINT_REV,
    at: Date.now(),
  };
}

let nodeGraphRasterRgbPumpQueued = false;
let nodeGraphRasterRgbLastError = "";

function nodeGraphRasterRgbSe(level, msg) {
  const text = `[raster-rgb ${NODE_GRAPH_RASTER_RGB_PAINT_REV}] ${msg}`;
  try {
    if (level === "FAIL" && typeof console !== "undefined" && console.error) {
      console.error(text);
    }
  } catch (_err) {
    // ignore
  }
  try {
    const se = typeof window !== "undefined" ? window.SE : null;
    if (!se) {
      return;
    }
    if (level === "FAIL" && typeof se.FAIL === "function") {
      se.FAIL(text);
    }
  } catch (_err) {
    // ignore
  }
}

function nodeGraphRasterRgbNoteError(nodeId, err) {
  const msg = `${nodeId || "?"}: ${err && err.message ? err.message : err}`;
  nodeGraphRasterRgbLastError = msg;
  nodeGraphRasterRgbSe("FAIL", msg);
}

function nodeGraphRasterRgbBuildStamp() {
  const token = document.querySelector?.("[data-build-token-value]")?.textContent?.trim() || "";
  const version = document.querySelector?.("[data-sandbox-version]")?.textContent?.trim() || "";
  const build = document.querySelector?.("[data-build-number-value]")?.textContent?.trim() || "";
  return { version, build, token, paintRev: NODE_GRAPH_RASTER_RGB_PAINT_REV };
}

function nodeGraphRasterRgbDebugDump() {
  const stamp = nodeGraphRasterRgbBuildStamp();
  const faces = typeof nodeGraphRasterRgbCollectFaces === "function"
    ? nodeGraphRasterRgbCollectFaces()
    : [];
  const dump = {
    ...stamp,
    parsed: true,
    lastError: nodeGraphRasterRgbLastError || "",
    faceCount: faces.length,
    faces: faces.map(({ slot, face }) => {
      const canvas = face?.querySelector?.(":scope > .node-raster-rgb-canvas");
      return {
        nodeId: slot?.nodeId || face?.dataset?.node || "",
        type: slot?.type || "",
        renderer: typeof nodeGraphModuleDisplayRendererForSlot === "function"
          ? nodeGraphModuleDisplayRendererForSlot(slot)
          : "",
        faceCss: `${face?.clientWidth || 0}x${face?.clientHeight || 0}`,
        canvasPx: canvas ? `${canvas.width}x${canvas.height}` : "none",
        last: canvas?._rasterRgbDebug || null,
      };
    }),
  };
  try {
    console.info("[raster-rgb dump]", dump);
  } catch (_err) {
    // ignore
  }
  return dump;
}

// Live collection (browser-maintained); filtered by type per frame.
let nodeGraphRasterRgbScopeWindows = null;

// An off-screen Scan Grid that feeds a visible sink acts as a video producer:
// it asks the video graph for a frame, so the graph's needed set (cached per
// graph frame) is recomputed and drops it as soon as no visible sink reads it.
const nodeGraphRasterRgbVideoTicks = new Set();

function nodeGraphRasterRgbTickVideoGraph(nodeId) {
  if (typeof nodeGraphVideoGraphRequestFrame !== "function" || nodeGraphRasterRgbVideoTicks.has(nodeId)) {
    return;
  }
  nodeGraphRasterRgbVideoTicks.add(nodeId);
  nodeGraphVideoGraphRequestFrame(nodeId, () => nodeGraphRasterRgbVideoTicks.delete(nodeId));
}

/**
 * Off screen (viewport-asleep / outside screen solo): null when nothing needs
 * the face (skip it), "asleep" when a visible sink reads the 📺 out (scan and
 * publish, no present), "" when on screen.
 */
function nodeGraphRasterRgbFaceMode(face, nodeId) {
  const host = face?.closest?.(".dsp-node");
  const hidden = host?.classList.contains("viewport-asleep")
    || (typeof nodeGraphScreenSoloAllowsNode === "function" && !nodeGraphScreenSoloAllowsNode(nodeId));
  if (!hidden) {
    return "";
  }
  if (typeof nodeGraphVideoGraphShouldSleep !== "function" || nodeGraphVideoGraphShouldSleep(nodeId)) {
    return null;
  }
  nodeGraphRasterRgbTickVideoGraph(nodeId);
  return "asleep";
}

function nodeGraphRasterRgbCollectFaces() {
  const faces = [];
  const seen = new Set();
  if (typeof nodeGraphVisibleModuleScopeSlots === "function") {
    for (const slot of nodeGraphVisibleModuleScopeSlots()) {
      const renderer = typeof nodeGraphModuleDisplayRendererForSlot === "function"
        ? nodeGraphModuleDisplayRendererForSlot(slot)
        : "";
      if (renderer !== "rasterRgbFace" && slot?.type !== "rasterRgb") {
        continue;
      }
      if (!slot?.scopeElement || seen.has(slot.scopeElement)) {
        continue;
      }
      seen.add(slot.scopeElement);
      const mode = nodeGraphRasterRgbFaceMode(slot.scopeElement, slot.nodeId);
      if (mode === null) {
        continue;
      }
      faces.push({ slot, face: slot.scopeElement, asleep: mode === "asleep" });
    }
  }
  if (typeof document !== "undefined") {
    nodeGraphRasterRgbScopeWindows ||= document.getElementsByClassName("node-module-scope-window");
    for (let i = 0; i < nodeGraphRasterRgbScopeWindows.length; i += 1) {
      const face = nodeGraphRasterRgbScopeWindows[i];
      if (seen.has(face)) {
        continue;
      }
      const host = face.closest?.(".dsp-node");
      if (face.dataset?.nodeType !== "rasterRgb" && host?.dataset?.nodeType !== "rasterRgb") {
        continue;
      }
      const nodeId = face.dataset?.node || host?.dataset?.node;
      seen.add(face);
      const mode = nodeGraphRasterRgbFaceMode(face, nodeId);
      if (mode === null) {
        continue;
      }
      const slot = (typeof nodeGraphModuleScopeState === "object"
        && nodeGraphModuleScopeState?.slots?.get?.(nodeId))
        || { nodeId, scopeElement: face, type: "rasterRgb" };
      faces.push({ slot, face, asleep: mode === "asleep" });
    }
  }
  return faces;
}

const nodeGraphRasterRgbIngestClock = { gen: 0, done: 0 };

function nodeGraphRasterRgbArmIngest() {
  nodeGraphRasterRgbIngestClock.gen += 1;
}

function nodeGraphRasterRgbShouldIngest() {
  return nodeGraphRasterRgbIngestClock.gen !== nodeGraphRasterRgbIngestClock.done;
}

function nodeGraphRasterRgbConsumeIngest() {
  nodeGraphRasterRgbIngestClock.done = nodeGraphRasterRgbIngestClock.gen;
}

function nodeGraphRasterRgbLiveLoopActive() {
  if (typeof scopePaintShouldFullDraw === "function") {
    return scopePaintShouldFullDraw(false);
  }
  if (typeof nodeGraphModuleScopeLivePaintActive === "function") {
    return nodeGraphModuleScopeLivePaintActive();
  }
  return typeof nodeGraphModuleScopePaused !== "function" || !nodeGraphModuleScopePaused();
}

function scheduleNodeGraphRasterRgbPump() {
  if (nodeGraphRasterRgbPumpQueued) {
    return;
  }
  nodeGraphRasterRgbPumpQueued = true;
  const raf = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : (fn) => setTimeout(fn, 16);
  raf(() => {
    nodeGraphRasterRgbPumpQueued = false;
    const faces = nodeGraphRasterRgbCollectFaces();
    if (!faces.length) {
      return;
    }
    const live = nodeGraphRasterRgbLiveLoopActive();
    const tracesOff = typeof nodeGraphModuleScopeTracesOff === "function"
      && nodeGraphModuleScopeTracesOff();
    // Live compositor owns the Simulation FPS tick so Scan Grid stays
    // phase-locked with phosphor / traces. Pump only covers pause + traces-off.
    if (live && !tracesOff) {
      scheduleNodeGraphRasterRgbPump();
      return;
    }
    if (live && tracesOff) {
      const frameReady = typeof nodeGraphDisplayFrameReady === "function"
        ? nodeGraphDisplayFrameReady("rasterRgb")
        : true;
      if (frameReady) {
        nodeGraphRasterRgbArmIngest();
        paintNodeGraphRasterRgbFacesNow();
      }
      scheduleNodeGraphRasterRgbPump();
      return;
    }
    paintNodeGraphRasterRgbFacesNow();
    scheduleNodeGraphRasterRgbPump();
  });
}

function paintNodeGraphRasterRgbFacesNow(pixelRatio = nodeGraphDisplayCanvasPixelRatio()) {
  const pr = Math.max(1, nodeGraphFiniteNumber(pixelRatio, nodeGraphDisplayCanvasPixelRatio()));
  let painted = 0;
  for (const { slot, face, asleep } of nodeGraphRasterRgbCollectFaces()) {
    const nodeId = slot?.nodeId || face?.dataset?.node;
    if (typeof scopePaintIsFacePoweredOff === "function" && scopePaintIsFacePoweredOff(nodeId)) {
      wipeNodeGraphRasterRgbScreensToColdBoot({ nodeId });
      continue;
    }
    try {
      drawNodeGraphRasterRgbFaceItem(null, {
        nodeId: slot?.nodeId,
        screenElement: face,
        slot,
        asleep,
      }, pr);
      painted += 1;
    } catch (err) {
      nodeGraphRasterRgbNoteError(slot?.nodeId || face?.dataset?.node, err);
    }
  }
  nodeGraphRasterRgbConsumeIngest();
  return painted;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.rasterRgbFace = function nodeGraphRasterRgbScopeHook() {
    // Live write/present is once, after the shared Simulation FPS gate.
  };
}
if (typeof nodeGraphModuleScopeRegisterFaceWipe === "function") {
  nodeGraphModuleScopeRegisterFaceWipe("rasterRgbFace", (canvas, _bg, options) => {
    wipeNodeGraphRasterRgbScreensToColdBoot({
      canvas: canvas || options?.canvas,
      nodeId: options?.nodeId,
      all: options?.all,
    });
  });
}

if (typeof window !== "undefined") {
  window.NODE_GRAPH_RASTER_RGB_PAINT_REV = NODE_GRAPH_RASTER_RGB_PAINT_REV;
  window.nodeGraphRasterRgbDebugDump = nodeGraphRasterRgbDebugDump;
}

scheduleNodeGraphRasterRgbPump();
