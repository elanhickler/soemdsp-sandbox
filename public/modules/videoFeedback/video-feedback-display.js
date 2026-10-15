const NODE_GRAPH_VIDEO_FEEDBACK_FFT = 256;

function nodeGraphVideoFeedbackPortLabel(_node, port) {
  const key = String(port || "");
  if (key === "rgba" || key === "📺") return "📺";
  if (key === "A") return "In";
  if (key === "B") return "Spin";
  return key;
}

const NODE_GRAPH_VIDEO_FEEDBACK_INK_HEX = "#8cd1ff";

function normalizeNodeGraphVideoFeedbackSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const hex = typeof normalizeNodeGraphTraceDisplayColor === "function"
    ? normalizeNodeGraphTraceDisplayColor(
      source.dot1Color || source.spectrumColor || source.color,
      NODE_GRAPH_VIDEO_FEEDBACK_INK_HEX,
    )
    : String(source.dot1Color || source.spectrumColor || source.color || NODE_GRAPH_VIDEO_FEEDBACK_INK_HEX);
  return {
    dot1Color: hex,
    spectrumColor: hex,
    color: hex,
  };
}

function nodeGraphVideoFeedbackSettingsForNode(node) {
  return normalizeNodeGraphVideoFeedbackSettings(node?.traceDisplaySettings);
}

function nodeGraphVideoFeedbackHexRgb01(hex) {
  const raw = String(hex || NODE_GRAPH_VIDEO_FEEDBACK_INK_HEX).trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(raw);
  if (!m) return [0.55, 0.82, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function buildNodeGraphVideoFeedbackDisplaySettingsBodyHtml() {
  const colorRow = typeof nodeGraphDisplaySettingsBuildColorRowHtml === "function"
    ? nodeGraphDisplaySettingsBuildColorRowHtml("dot1Color", "videoFeedbackFace")
    : "";
  return `
    <div class="metadata-field-section" data-video-feedback-display-settings-panel>
      <div class="metadata-section-title">SPECTRUM</div>
      ${colorRow}
    </div>
  `;
}

function nodeGraphVideoFeedbackReadParam(nodeId, key, fallback) {
  if (typeof nodeGraphReadNodeNumber === "function") {
    const n = nodeGraphReadNodeNumber(nodeId, key);
    if (Number.isFinite(n)) return n;
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const raw = Number(node?.params?.[key]);
  return Number.isFinite(raw) ? raw : fallback;
}

function nodeGraphVideoFeedbackBufferFromKey(nodeId, port) {
  const state = typeof nodeGraphModuleScopeState === "object" ? nodeGraphModuleScopeState : null;
  if (!state?.buffers || !nodeId) return null;
  const names = [port, String(port).toLowerCase(), String(port).toUpperCase()];
  for (let i = 0; i < names.length; i += 1) {
    const ring = state.buffers.get(`${nodeId}:${names[i]}`);
    if (ring?.length) return ring;
  }
  if (typeof nodeGraphModuleScopeConnectedSourceBuffer === "function") {
    const connected = nodeGraphModuleScopeConnectedSourceBuffer(nodeId, port);
    if (connected?.length) return connected;
  }
  return null;
}

function nodeGraphVideoFeedbackRingCount(ring) {
  if (!ring?.length) return 0;
  if (typeof nodeGraphScopeAvailableSampleCount === "function") {
    return nodeGraphScopeAvailableSampleCount(ring) || ring.length;
  }
  return ring.length;
}

function nodeGraphVideoFeedbackLatest(ring) {
  const n = nodeGraphVideoFeedbackRingCount(ring);
  if (!(n > 0)) return 0;
  const v = Number(ring[n - 1]);
  return Number.isFinite(v) ? v : 0;
}

function nodeGraphVideoFeedbackEnsureSpectrumState(canvas) {
  const n = NODE_GRAPH_VIDEO_FEEDBACK_FFT;
  let st = canvas._videoFeedbackSpectrum;
  if (st && st.real.length === n) return st;
  const hann = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  st = {
    real: new Float64Array(n),
    imag: new Float64Array(n),
    mag: new Float32Array(n),
    smooth: new Float32Array(n),
    hann,
  };
  canvas._videoFeedbackSpectrum = st;
  return st;
}

function nodeGraphVideoFeedbackSpectrumWindow(canvas, ring, smooth01) {
  const n = NODE_GRAPH_VIDEO_FEEDBACK_FFT;
  const bins = n / 2;
  const st = nodeGraphVideoFeedbackEnsureSpectrumState(canvas);
  st.real.fill(0);
  st.imag.fill(0);
  const count = nodeGraphVideoFeedbackRingCount(ring);
  const take = Math.min(count, n);
  const src0 = Math.max(0, count - take);
  const dst0 = n - take;
  for (let i = 0; i < take; i += 1) {
    st.real[dst0 + i] = (Number(ring[src0 + i]) || 0) * st.hann[dst0 + i];
  }
  if (typeof nodeGraphSpectrumFftInPlace === "function") {
    nodeGraphSpectrumFftInPlace(st.real, st.imag);
  }
  const keep = Math.max(0, Math.min(0.97, Number(smooth01) || 0));
  const attack = 1 - keep;
  const nyquist = bins - 1;
  for (let i = 0; i < n; i += 1) {
    const t = (i + 0.5) / n;
    const logT = (Math.pow(2, t * 10) - 1) / (1024 - 1);
    const f = Math.max(0, Math.min(nyquist, logT * nyquist));
    const i0 = Math.floor(f);
    const i1 = Math.min(nyquist, i0 + 1);
    const fr = f - i0;
    const m0 = Math.hypot(st.real[i0], st.imag[i0]);
    const m1 = Math.hypot(st.real[i1], st.imag[i1]);
    const mag = (m0 * (1 - fr) + m1 * fr) / (n * 0.25);
    const db = 20 * Math.log10(mag + 1e-8);
    const v = Math.max(0, Math.min(1, (db + 72) / 72));
    st.smooth[i] += (v - st.smooth[i]) * attack;
    st.mag[i] = st.smooth[i];
  }
  return st.mag;
}

function nodeGraphVideoFeedbackWaveWindow(ring, outLen) {
  const n = nodeGraphVideoFeedbackRingCount(ring);
  if (!(n > 0) || !(outLen > 0)) return null;
  const start = Math.max(0, n - outLen);
  if (start === 0 && n === outLen) return ring;
  const slice = new Float32Array(Math.min(outLen, n));
  for (let i = 0; i < slice.length; i += 1) {
    slice[i] = Number(ring[start + i]) || 0;
  }
  return slice;
}

function nodeGraphVideoFeedbackEnsureCanvas(face, pixelRatio) {
  if (!face) return null;
  for (const leftover of face.querySelectorAll(":scope > .node-module-scope-local-fallback-canvas")) {
    leftover.remove();
  }
  let canvas = face.querySelector(":scope > .node-video-feedback-canvas");
  if (!canvas) {
    canvas = nodeGraphDisplayCanvasCreate("node-video-feedback-canvas");
    canvas.setAttribute("aria-hidden", "true");
    face.appendChild(canvas);
  }
  // Shared sizing (layout css x dpr, never zoom); backing stays >= 8 px.
  if (typeof nodeGraphDisplayCanvasSize === "function") {
    const m = nodeGraphDisplayCanvasSize(face, canvas);
    if (m && (m.width < 8 || m.height < 8) && typeof nodeGraphDisplayCanvasSizeCss === "function") {
      nodeGraphDisplayCanvasSizeCss(canvas, Math.max(8, m.width) / m.pixelRatio, Math.max(8, m.height) / m.pixelRatio, 1);
    }
  }
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.zIndex = "5";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "none";
  return canvas;
}

function nodeGraphVideoFeedbackCircuitLive() {
  try {
    if (typeof nodeGraphModuleScopeEnginePaused === "function" && nodeGraphModuleScopeEnginePaused()) {
      return false;
    }
  } catch (_e) { /* fall through */ }
  try {
    if (typeof scopePaintIsFrozen === "function" && scopePaintIsFrozen()) {
      return false;
    }
  } catch (_e) { /* fall through */ }
  try {
    if (typeof nodeGraphModuleScopePhosphorFrozen === "function" && nodeGraphModuleScopePhosphorFrozen()) {
      return false;
    }
  } catch (_e) { /* fall through */ }
  return true;
}

function drawNodeGraphVideoFeedbackFaceItem(_renderer, item, pixelRatio) {
  const slot = item?.slot;
  const face = item?.screenElement || slot?.scopeElement;
  if (!slot || !face) return;
  const canvas = nodeGraphVideoFeedbackEnsureCanvas(face, pixelRatio);
  if (!canvas) return;
  // 2D present surface for the shared-GL blit (display-canvas.js); no 2D drawing here.
  const ctx = typeof nodeGraphDisplayCanvasPresentContext === "function" ? nodeGraphDisplayCanvasPresentContext(canvas) : null;
  if (!ctx) return;
  const nodeId = slot.nodeId;
  const node = typeof nodeGraphModuleScopeNodeForSlot === "function"
    ? nodeGraphModuleScopeNodeForSlot(slot)
    : (typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null);
  const decay = Math.max(0, Math.min(0.98, nodeGraphVideoFeedbackReadParam(nodeId, "decay", 0.33)));
  const zoom = Math.max(0, Math.min(1, nodeGraphVideoFeedbackReadParam(nodeId, "zoom", 0.22)));
  const twist = Math.max(-1, Math.min(1, nodeGraphVideoFeedbackReadParam(nodeId, "twist", 0)));
  const bright = Math.max(0, Math.min(1, nodeGraphVideoFeedbackReadParam(nodeId, "bright", 0.75)));
  const smooth = Math.max(0, Math.min(1, nodeGraphVideoFeedbackReadParam(nodeId, "smooth", 0.64)));
  const ringA = nodeGraphVideoFeedbackBufferFromKey(nodeId, "A");
  const ringB = nodeGraphVideoFeedbackBufferFromKey(nodeId, "B");
  const bSigned = Math.max(-1, Math.min(1, nodeGraphVideoFeedbackLatest(ringB)));
  const ink = nodeGraphVideoFeedbackHexRgb01(nodeGraphVideoFeedbackSettingsForNode(node).dot1Color);
  const wave = nodeGraphVideoFeedbackSpectrumWindow(canvas, ringA, smooth);
  const host = canvas;
  if (face._videoFeedbackOwnsClock && item?.fromFaceLoop !== true && item?.force !== true) {
    return;
  }
  const frozen = !nodeGraphVideoFeedbackCircuitLive();
  if (typeof nodeGraphVideoFeedbackGlEnsure !== "function") {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  const renderer = nodeGraphVideoFeedbackGlEnsure(host, canvas.width, canvas.height);
  if (!renderer) {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  if (!frozen && typeof nodeGraphVideoFeedbackGlStep === "function") {
    nodeGraphVideoFeedbackGlStep(host, {
      nodeId,
      decay,
      mix: 0,
      mode: 1,
      a: 0,
      b: bSigned,
      zoom,
      twist,
      bright,
      time: 0,
      picture: null,
      waveSamples: wave,
      waveIsMagnitude: true,
      smooth,
      ink,
    });
  }
  if (typeof nodeGraphVideoFeedbackGlPresent === "function") {
    nodeGraphVideoFeedbackGlPresent(host, ctx, canvas.width, canvas.height);
  }
  if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
    nodeGraphModuleScopeMarkScreenLit(face, 1);
  }
}

function wipeNodeGraphVideoFeedbackScreensToColdBoot(canvas) {
  const host = canvas || null;
  if (host && typeof nodeGraphVideoFeedbackGlWipe === "function") {
    nodeGraphVideoFeedbackGlWipe(host);
  }
  if (canvas && typeof nodeGraphGlLinesFillBlack === "function") {
    nodeGraphGlLinesFillBlack(canvas);
  }
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.videoFeedbackFace = drawNodeGraphVideoFeedbackFaceItem;
}
if (typeof nodeGraphModuleScopeRegisterFaceWipe === "function") {
  nodeGraphModuleScopeRegisterFaceWipe("videoFeedbackFace", (canvas) => {
    wipeNodeGraphVideoFeedbackScreensToColdBoot(canvas);
  });
}
