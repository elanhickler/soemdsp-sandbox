// Phone Tone face — sharp vector readout (filter-curve family).
// Not the animated scope compositor / local-fallback canvas.
// Cascadia Mono, ƒ1 | ƒ2 Hz, redraw only when values or layout change.

const NODE_GRAPH_PHONE_TONE_FACE_FONT =
  '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace';

function nodeGraphPhoneToneFaceFormatHz(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return "—";
  }
  if (Math.abs(n - Math.round(n)) < 0.05) {
    return String(Math.round(n));
  }
  return n.toFixed(1);
}

function nodeGraphPhoneToneFaceHasInput(nodeId, port) {
  if (typeof nodeGraphModuleScopeConnectionsTo !== "function") {
    return false;
  }
  return nodeGraphModuleScopeConnectionsTo(nodeId, port).some(
    (candidate) => candidate?.sourceNode && candidate?.sourcePort,
  );
}

function nodeGraphPhoneToneFaceInputValue(nodeId, port) {
  if (typeof nodeGraphModuleScopeConnectedSourceBuffer !== "function") {
    return 0;
  }
  const buffer = nodeGraphModuleScopeConnectedSourceBuffer(nodeId, port);
  if (!buffer?.length) {
    return 0;
  }
  for (let index = buffer.length - 1; index >= 0; index -= 1) {
    const value = Number(buffer[index]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function nodeGraphPhoneToneFaceHzPair(nodeId) {
  const readHz = (port, fallbackPort) => {
    if (typeof nodeGraphModuleScopeLatestOutputValue !== "function") {
      return Number.NaN;
    }
    const primary = nodeGraphModuleScopeLatestOutputValue(nodeId, port, Number.NaN);
    if (Number.isFinite(primary)) {
      return primary;
    }
    return nodeGraphModuleScopeLatestOutputValue(nodeId, fallbackPort, Number.NaN);
  };
  const reported1 = readHz("ƒ1", "Df1");
  const reported2 = readHz("ƒ2", "Df2");
  if (Number.isFinite(reported1) && Number.isFinite(reported2) && (reported1 > 0 || reported2 > 0)) {
    return [reported1, reported2];
  }
  const hasAnalog = nodeGraphPhoneToneFaceHasInput(nodeId, "Analog");
  const hasDigital = nodeGraphPhoneToneFaceHasInput(nodeId, "Digital");
  const analogSlot = hasAnalog && typeof nodeGraphPhoneToneAnalogSlot === "function"
    ? nodeGraphPhoneToneAnalogSlot(nodeGraphPhoneToneFaceInputValue(nodeId, "Analog"))
    : null;
  const digitalSlot = hasDigital && typeof nodeGraphPhoneToneDigitalSlot === "function"
    ? nodeGraphPhoneToneDigitalSlot(nodeGraphPhoneToneFaceInputValue(nodeId, "Digital"))
    : null;
  const slot = digitalSlot != null ? digitalSlot : analogSlot;
  if (slot == null || typeof nodeGraphPhoneTonePair !== "function") {
    return [0, 0];
  }
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const offset = Number(node?.params?.freqOffset);
  const freqOffset = Number.isFinite(offset) ? offset : 0;
  const pitchOff = Number(node?.params?.pitchOffset);
  const pitchOffset = Number.isFinite(pitchOff) ? pitchOff : 0;
  const pair = nodeGraphPhoneTonePair(slot);
  if (typeof nodeGraphPhoneTonePitchedHz === "function") {
    return [
      nodeGraphPhoneTonePitchedHz(pair[0], pitchOffset, freqOffset, 1),
      nodeGraphPhoneTonePitchedHz(pair[1], pitchOffset, freqOffset, 1),
    ];
  }
  const ratio = typeof nodeGraphPhoneToneOctaveRatio === "function"
    ? nodeGraphPhoneToneOctaveRatio(pitchOffset)
    : 1;
  return [pair[0] * ratio + freqOffset, pair[1] * ratio + freqOffset];
}

function createNodeGraphPhoneToneDisplay(nodeId, type = "phoneTone") {
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-phone-tone-display node-module-face";
  section.dataset.node = String(nodeId || "");
  section.dataset.nodeType = String(type || "phoneTone");
  if (typeof tagNodeGraphModuleBand === "function") {
    tagNodeGraphModuleBand(section, "face");
  }
  section.dataset.parameterVisual = "true";
  section.dataset.lightSource = "screen";
  section.dataset.lightStrength = "0.4";
  const canvas = nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-phone-tone-canvas node-module-scope-vector-trace");
  canvas.setAttribute("aria-hidden", "true");
  section.append(canvas);
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `phoneTone:${el.dataset?.node || ""}`,
    paint: drawNodeGraphPhoneToneFaceItem,
    onResize: (el) => { el._phoneToneLaidOut = false; },
  });
  return section;
}

function drawNodeGraphPhoneToneFacePane(batch, cx, maxW, label, hz, labelSize, valueSize, unitSize, labelY, valueY, unitY) {
  const opt = (px, rgba) => ({ px, rgba, weight: 700, family: NODE_GRAPH_PHONE_TONE_FACE_FONT, maxWidth: maxW });
  nodeGraphGlLinesText(batch, label, cx, labelY, opt(labelSize, [160 / 255, 167 / 255, 176 / 255, 0.9]));
  nodeGraphGlLinesText(batch, hz, cx, valueY, opt(valueSize, [160 / 255, 214 / 255, 228 / 255, 0.98]));
  nodeGraphGlLinesText(batch, "Hz", cx, unitY, opt(unitSize, [160 / 255, 167 / 255, 176 / 255, 0.82]));
}

function drawNodeGraphPhoneToneFaceItem(sectionOrRenderer, item) {
  const section = sectionOrRenderer?.classList?.contains?.("node-phone-tone-display")
    ? sectionOrRenderer
    : (item?.screenElement?.closest?.(".node-phone-tone-display")
      || item?.slot?.scopeElement
      || null);
  if (!section) {
    return;
  }
  const nodeId = section.dataset?.node || item?.slot?.nodeId;
  if (!nodeId) {
    return;
  }
  const canvas = section.querySelector?.(".node-phone-tone-canvas")
    || section.querySelector?.("canvas");
  if (!canvas) {
    return;
  }
  const pair = nodeGraphPhoneToneFaceHzPair(nodeId);
  const left = nodeGraphPhoneToneFaceFormatHz(pair[0]);
  const right = nodeGraphPhoneToneFaceFormatHz(pair[1]);
  const rawW = nodeGraphFiniteNumber(section.clientWidth || section.offsetWidth);
  const rawH = nodeGraphFiniteNumber(section.clientHeight || section.offsetHeight);
  const signature = `${left}|${right}|${Math.round(rawW)}|${Math.round(rawH)}`;
  if (
    !section._forceDraw
    && section._phoneToneSignature === signature
    && section._phoneToneLaidOut
  ) {
    return;
  }
  if (rawW < 8 || rawH < 8) {
    section._phoneToneLaidOut = false;
    section._forceDraw = true;
    return;
  }

  const m = typeof nodeGraphDisplayCanvasSize === "function" ? nodeGraphDisplayCanvasSize(section, canvas) : null;
  if (!m || !(m.cssWidth >= 8) || !(m.cssHeight >= 8)) {
    return;
  }
  const width = m.cssWidth;
  const height = m.cssHeight;
  section._phoneToneSignature = signature;
  section._forceDraw = false;
  section._phoneToneLaidOut = true;
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, [0, 0, 4 / 255, 1], { scale: m.pixelRatio })
    : null;
  if (!batch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  const mid = Math.round(width * 0.5);
  nodeGraphGlLinesRect(batch, mid, Math.round(height * 0.12), 1, Math.round(height * 0.76), [127 / 255, 199 / 255, 217 / 255, 0.22]);

  const paneW = Math.max(8, mid - 8);
  const labelSize = Math.max(9, Math.min(height * 0.18, width * 0.07));
  const valueSize = Math.max(12, Math.min(height * 0.36, (width * 0.5) * 0.24));
  const unitSize = Math.max(8, Math.min(height * 0.16, width * 0.055));
  drawNodeGraphPhoneToneFacePane(
    batch, width * 0.25, paneW, "ƒ1", left, labelSize, valueSize, unitSize,
    height * 0.2, height * 0.54, height * 0.82,
  );
  drawNodeGraphPhoneToneFacePane(
    batch, width * 0.75, paneW, "ƒ2", right, labelSize, valueSize, unitSize,
    height * 0.2, height * 0.54, height * 0.82,
  );
  if (!nodeGraphGlLinesEnd(batch) && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.phoneToneFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("phoneToneFace", createNodeGraphPhoneToneDisplay);
}
