// Pitch Manager display: the numbers the module works with, one per line.
//   0–1     the 0–1 input as received (— when the jack is not wired)
//   In      the pitch input (MIDI note number + name)
//   Out     the final pitch after the 0–1 range, Octave, Semitones, Cents
//   ƒ       the final frequency after Multiply and Add
// Live values come from the engine taps (__Unit, __InPitch) and the module's
// own pitch / ƒ outputs. Before audio runs, the lines show what the knobs give
// on their own (no inputs). GPU only, shared line / text drawer (gl-line-renderer).

const NODE_GRAPH_PITCH_MANAGER_NOTE_NAMES = Object.freeze(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]);

/** "60.00 C4" style: MIDI number with the nearest note name (MIDI 60 = C4). */
function nodeGraphPitchManagerPitchText(pitch) {
  if (!Number.isFinite(pitch)) return "—";
  const nearest = Math.round(pitch);
  const name = NODE_GRAPH_PITCH_MANAGER_NOTE_NAMES[((nearest % 12) + 12) % 12];
  const octave = Math.floor(nearest / 12) - 1;
  return `${pitch.toFixed(2)} ${name}${octave}`;
}

function nodeGraphPitchManagerHzText(hz) {
  if (!Number.isFinite(hz)) return "—";
  const a = Math.abs(hz);
  const digits = a >= 1000 ? 1 : a >= 100 ? 2 : 3;
  return `${hz.toFixed(digits)} Hz`;
}

function nodeGraphPitchManagerParam(node, key, fallback) {
  const live = typeof nodeGraphSinCosLiveParam === "function" ? nodeGraphSinCosLiveParam(node, key, fallback) : node?.params?.[key];
  const n = Number(live);
  return Number.isFinite(n) ? n : fallback;
}

function nodeGraphPitchManagerUnitWired(nodeId) {
  const connections = nodeGraphMvp?.patch?.connections || [];
  return connections.some((c) => String(c?.destinationNode) === String(nodeId) && String(c?.destinationPort) === "unit");
}

/** The four values: live from the engine, else what the knobs give alone. */
function nodeGraphPitchManagerValues(node) {
  const id = String(node?.id || "");
  const latest = (port) => (typeof nodeGraphModuleScopeLatestOutputValue === "function"
    ? Number(nodeGraphModuleScopeLatestOutputValue(id, port, Number.NaN))
    : Number.NaN);
  const outPitch = latest("pitch");
  const hz = latest("f");
  const unitWired = nodeGraphPitchManagerUnitWired(id);
  if (Number.isFinite(outPitch) && Number.isFinite(hz)) {
    return { unit: unitWired ? latest("__Unit") : Number.NaN, inPitch: latest("__InPitch"), outPitch, hz };
  }
  // Not running: the knobs alone (no input).
  const tuning = nodeGraphPitchManagerParam(node, "tuning", 440);
  const pitch = nodeGraphPitchManagerParam(node, "octave", 0) * 12
    + nodeGraphPitchManagerParam(node, "semitones", 0)
    + nodeGraphPitchManagerParam(node, "cents", 0) / 100;
  const base = tuning * Math.pow(2, (pitch - 69) / 12);
  return {
    unit: Number.NaN,
    inPitch: Number.NaN,
    outPitch: pitch,
    hz: base * nodeGraphPitchManagerParam(node, "multiply", 1) + nodeGraphPitchManagerParam(node, "add", 0),
  };
}

function drawNodeGraphPitchManagerFace(section) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section?.dataset?.node || "") : null;
  const canvas = section?.querySelector?.(".node-display-face");
  if (!node || !canvas || typeof nodeGraphCycleLineGlMetrics !== "function") return;
  const metrics = nodeGraphCycleLineGlMetrics(section, canvas, 1);
  if (!metrics) return;
  const { cssWidth: w, cssHeight: h, pixelRatio } = metrics;
  const v = nodeGraphPitchManagerValues(node);
  const lines = [
    ["0–1", Number.isFinite(v.unit) ? v.unit.toFixed(3) : "—"],
    ["In", nodeGraphPitchManagerPitchText(v.inPitch)],
    ["Out", nodeGraphPitchManagerPitchText(v.outPitch)],
    ["ƒ", nodeGraphPitchManagerHzText(v.hz)],
  ];
  // Repaint only when a number changes.
  const sig = `${w}x${h}|${lines.map((l) => l[1]).join("|")}`;
  if (sig === section._pitchManagerSig && !section._pitchManagerForceDraw) return;
  section._pitchManagerSig = sig;
  section._pitchManagerForceDraw = false;
  const rgba = (css, fallback) => (typeof nodeGraphGlGraphParseCssColor === "function"
    ? nodeGraphGlGraphParseCssColor(css, fallback)
    : fallback);
  // Text sized from the row height here (it already follows the tile), so no batch text ink.
  const batch = nodeGraphGlLinesBegin(canvas, rgba("#06080c", [0.02, 0.03, 0.05, 1]), { scale: pixelRatio, textInk: false });
  if (!batch) {
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(canvas, "pitch manager: no shared GL device");
    return;
  }
  const rowH = h / lines.length;
  const ink = typeof nodeGraphGlLinesInkScale === "function" ? nodeGraphGlLinesInkScale(canvas) : 1;
  const px = Math.max(8, Math.min(rowH * 0.62, 15 * ink));
  const pad = Math.max(6, w * 0.05);
  const labelInk = rgba("#7fc7d9", [0.5, 0.78, 0.85, 1]);
  const valueInk = rgba("#f2f5ff", [0.95, 0.96, 1, 1]);
  const text = (s, x, y, align, ink) => nodeGraphGlLinesText(batch, s, x, y, {
    px, rgba: ink, align, baseline: "middle", weight: 400,
    family: "\"Cascadia Mono\", Consolas, \"Courier New\", monospace",
  });
  lines.forEach(([label, value], i) => {
    const y = rowH * (i + 0.5);
    text(label, pad, y, "left", labelInk);
    text(value, w - pad, y, "right", valueInk);
  });
  if (!nodeGraphGlLinesEnd(batch, "alpha") && typeof nodeGraphDisplayGlFailed === "function") {
    nodeGraphDisplayGlFailed(canvas, "pitch manager: GL present failed");
  }
}

function createNodeGraphPitchManagerFace(nodeId, type = "pitchManager") {
  const id = nodeId && typeof nodeId === "object" ? String(nodeId.dataset?.node || nodeId.id || "") : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-pitch-manager-face node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "pitchManager");
  section.dataset.parameterVisual = "true";
  section.append(nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-pitch-manager-canvas"));
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `pitchManager:${el.dataset?.node || ""}`,
    forceKey: "_pitchManagerForceDraw",
    rafKey: "_pitchManagerRaf",
    paint: drawNodeGraphPitchManagerFace,
    onResize: (el) => {
      el._pitchManagerForceDraw = true;
      if (typeof syncFaceMetrics === "function") syncFaceMetrics(el);
    },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    section._pitchManagerForceDraw = true;
    drawNodeGraphPitchManagerFace(section);
    section._startFaceLoop?.();
  }));
  return section;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.pitchManagerFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("pitchManagerFace", createNodeGraphPitchManagerFace);
}
