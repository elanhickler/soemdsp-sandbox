// MIDI module last-message monitor face.
// Shared display pipeline only: display-canvas size, drawing-face pump,
// gl-line-renderer text (glyph atlas). Font scales with face min-side
// via faceInkPx. Canvas-view size comes from the tile CSS box.

function createNodeGraphMidiMonitorDisplay(nodeId, type = "keyboardController") {
  const id = nodeId && typeof nodeId === "object"
    ? String(nodeId.dataset?.node || nodeId.id || "")
    : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-midi-monitor-face node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "keyboardController");
  section.dataset.midiMonitor = "true";
  section.dataset.parameterVisual = "true";
  section.dataset.lightSource = "screen";
  section.dataset.lightStrength = "0.5";
  section.setAttribute("aria-label", "Last MIDI message");
  if (typeof tagNodeGraphModuleBand === "function") {
    tagNodeGraphModuleBand(section, "face");
  }
  const canvas = nodeGraphDisplayCanvasCreate("node-midi-monitor-canvas");
  section.append(canvas);
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `midiMonitor:${el.dataset?.node || ""}`,
    paint: drawNodeGraphMidiMonitorDisplay,
    paintKind: "param",
  });
  return section;
}

function nodeGraphMidiMonitorFaceText() {
  const rec = (typeof nodeGraphMvp === "object" && nodeGraphMvp)
    ? nodeGraphMvp.lastMidiMessage
    : null;
  if (!rec) {
    return { type: "no message", data: "\u2014", count: "#0", empty: true };
  }
  return {
    type: rec.type || "MIDI",
    data: rec.data || "\u2014",
    count: `#${Number(rec.count) || 0}`,
    empty: false,
  };
}

function drawNodeGraphMidiMonitorDisplay(section) {
  if (!section) return;
  const canvas = section.querySelector(".node-display-face");
  if (!canvas) return;
  const m = typeof nodeGraphDisplayCanvasSize === "function"
    ? nodeGraphDisplayCanvasSize(section, canvas)
    : null;
  if (!m || m.cssWidth < 8 || m.cssHeight < 8) return;
  const w = m.cssWidth;
  const h = m.cssHeight;
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, [5 / 255, 5 / 255, 8 / 255, 1], { scale: m.pixelRatio })
    : null;
  if (!batch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    section._forceDraw = false;
    return;
  }
  const rec = nodeGraphMidiMonitorFaceText();
  const minSide = typeof faceMinSide === "function" ? faceMinSide(w, h) : Math.min(w, h);
  const ink = (authored) => (typeof faceInkPx === "function"
    ? Math.max(7, faceInkPx(authored, minSide))
    : Math.max(7, authored * (minSide / 96)));
  let typePx = ink(16);
  let dataPx = ink(14);
  let countPx = ink(12);
  let gap = Math.max(2, ink(6));
  const total = typePx + dataPx + countPx + gap * 2;
  const fit = (h * 0.92) / Math.max(1, total);
  const scale = fit < 1 ? fit : 1;
  typePx *= scale;
  dataPx *= scale;
  countPx *= scale;
  gap *= scale;
  const block = typePx + dataPx + countPx + gap * 2;
  let y = (h - block) * 0.5 + typePx * 0.5;
  const muted = [0.45, 0.47, 0.5, 1];
  const typeRgba = rec.empty ? muted : [160 / 255, 214 / 255, 228 / 255, 0.98];
  const dataRgba = rec.empty ? muted : [0.92, 0.93, 0.94, 0.96];
  const countRgba = [160 / 255, 167 / 255, 176 / 255, 0.86];
  const pad = Math.max(6, ink(10));
  const maxW = Math.max(8, w - pad * 2);
  const family = 'ui-monospace, "Cascadia Mono", Consolas, monospace';
  const textOpts = (px, rgba) => ({
    px,
    weight: 700,
    family,
    rgba,
    align: "center",
    maxWidth: maxW,
  });
  if (typeof nodeGraphGlLinesText === "function") {
    nodeGraphGlLinesText(batch, rec.type, w * 0.5, y, textOpts(typePx, typeRgba));
    y += typePx * 0.5 + gap + dataPx * 0.5;
    nodeGraphGlLinesText(batch, rec.data, w * 0.5, y, textOpts(dataPx, dataRgba));
    y += dataPx * 0.5 + gap + countPx * 0.5;
    nodeGraphGlLinesText(batch, rec.count, w * 0.5, y, textOpts(countPx, countRgba));
  }
  section.setAttribute(
    "aria-label",
    rec.empty ? "Last MIDI message: none" : `Last MIDI message: ${rec.type} ${rec.data} ${rec.count}`,
  );
  if (!nodeGraphGlLinesEnd(batch) && typeof nodeGraphGlLinesFillBlack === "function") {
    nodeGraphGlLinesFillBlack(canvas);
  }
  section._forceDraw = false;
}

if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("midiMonitor", createNodeGraphMidiMonitorDisplay);
}
if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.midiMonitor = () => {};
}
