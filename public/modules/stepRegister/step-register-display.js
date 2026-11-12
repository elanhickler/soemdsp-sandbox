// Step Register face: the register lane.
// Columns = pattern ticks (Length). Rows = registers around a centre row
// (17 rows, -8..+8). Pitch runs upward, so on the Divide grid (higher
// register = lower pitch) register index increases downward.
//   - faint row lines, brighter centre row
//   - drawn steps: thick bar per tick (Offset: relative rows, Drawn: absolute)
//   - ideal pitch: thin amber line at the fractional register
//   - playhead: tick column + dot on the register actually playing
// Drag on the lane to draw steps (Offset / Drawn). Ctrl/Cmd-drag clears to 0
// (Offset) or the centre row (Drawn). Auto ignores the lane.
// WebGL via the shared stroke (nodeGraphGlLinesPresentFrame). No DSP here: live values come from the engine
// taps __Register / __Ideal / __Tick (process_step_register).

const NODE_GRAPH_STEP_REGISTER_HALF_ROWS = 8;
const NODE_GRAPH_STEP_REGISTER_MAX_STEPS = 64;

function createNodeGraphStepRegisterDisplay(nodeId, type = "stepRegister") {
  const id = nodeId && typeof nodeId === "object"
    ? String(nodeId.dataset?.node || nodeId.id || "")
    : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-basic-shape-display node-step-register-display node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "stepRegister");
  section.dataset.parameterVisual = "true";
  section.dataset.lightSource = "screen";
  section.dataset.lightStrength = "1";
  const canvas = nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-step-register-canvas");
  canvas.dataset.lightSource = "screen";
  canvas.dataset.lightStrength = "1";
  section.style.touchAction = "none";
  section.style.cursor = "crosshair";
  section.append(canvas);
  // Events go on the section: in GPU mode the canvas is visibility:hidden
  // (the GPU draws a copy), so it never receives pointer events.
  nodeGraphStepRegisterInstallEditing(section, section);
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `stepRegister:${el.dataset?.node || ""}`,
    forceKey: "_stepRegisterForceDraw",
    rafKey: "_stepRegisterRaf",
    paint: drawNodeGraphStepRegisterDisplay,
    onResize: (el) => {
      if (typeof syncFaceMetrics === "function") syncFaceMetrics(el);
      el._stepRegisterLaidOut = false;
    },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      drawNodeGraphStepRegisterDisplay(section);
      section._startFaceLoop?.();
    });
  });
  return section;
}

function nodeGraphStepRegisterParam(node, key, fallback = 0) {
  if (typeof nodeGraphFilterCurveLiveParam === "function") {
    const v = Number(nodeGraphFilterCurveLiveParam(node, key, fallback));
    return Number.isFinite(v) ? v : fallback;
  }
  const n = Number(node?.params?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

function nodeGraphStepRegisterSteps(node) {
  const raw = Array.isArray(node?.stepRegister?.steps) ? node.stepRegister.steps : [];
  const out = new Array(NODE_GRAPH_STEP_REGISTER_MAX_STEPS).fill(0);
  for (let i = 0; i < out.length && i < raw.length; i += 1) {
    const v = Math.round(Number(raw[i]));
    out[i] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

// Same grid math as process_step_register (graph_engine.cpp), for the
// stopped picture and the centre row.
function nodeGraphStepRegisterIdeal(node) {
  const bits = Math.max(1, Math.min(16, Math.round(nodeGraphStepRegisterParam(node, "bits", 5))));
  const count = 2 ** bits;
  const maxReg = count - 1;
  const grid = Math.max(0, Math.min(2, Math.round(nodeGraphStepRegisterParam(node, "grid", 0))));
  const clock = Math.max(1e-3, nodeGraphStepRegisterParam(node, "clock", 4000));
  const offset = nodeGraphStepRegisterParam(node, "gridOffset", 0);
  const hz = Math.max(1e-6, Math.abs(nodeGraphStepRegisterParam(node, "frequency", 220)));
  let x;
  if (grid === 0) x = clock / hz - 1;
  else if (grid === 1) x = (hz * count) / clock - 1;
  else {
    const hi = Math.max(20 * 1.0001, clock);
    x = (maxReg * Math.log(hz / 20)) / Math.log(hi / 20);
  }
  x -= offset;
  if (!Number.isFinite(x)) x = 0;
  const registerHz = (r) => {
    const shifted = Math.max(0, Math.min(maxReg, r + offset));
    if (grid === 0) return clock / (shifted + 1);
    if (grid === 1) return clock * (shifted + 1) / count;
    return 20 * Math.exp((shifted / maxReg) * Math.log(Math.max(20 * 1.0001, clock) / 20));
  };
  const firstHz = registerHz(0);
  const lastHz = registerHz(maxReg);
  return {
    ideal: Math.max(0, Math.min(maxReg, x)), maxReg, grid,
    minHz: Math.min(firstHz, lastHz), maxHz: Math.max(firstHz, lastHz),
  };
}

function nodeGraphStepRegisterFormatHz(value) {
  if (!Number.isFinite(value)) return "--";
  const magnitude = Math.abs(value);
  if (magnitude >= 10000) return `${(value / 1000).toFixed(1)}k`;
  if (magnitude >= 1000) return `${(value / 1000).toFixed(2)}k`;
  return value.toFixed(magnitude < 100 ? 1 : 0);
}

function nodeGraphStepRegisterLive(nodeId, key) {
  if (typeof nodeGraphModuleScopeLatestOutputValue !== "function") return Number.NaN;
  return Number(nodeGraphModuleScopeLatestOutputValue(nodeId, key, Number.NaN));
}

function nodeGraphStepRegisterLivePlaying() {
  return typeof nodeGraphRoundShapeLivePlaying === "function"
    ? nodeGraphRoundShapeLivePlaying()
    : false;
}

// Everything the lane needs, live when playing, from params when stopped.
function nodeGraphStepRegisterModel(nodeId, node) {
  const source = Math.max(0, Math.min(2, Math.round(nodeGraphStepRegisterParam(node, "source", 0))));
  const length = Math.max(1, Math.min(64, Math.round(nodeGraphStepRegisterParam(node, "patternLength", 8))));
  const steps = nodeGraphStepRegisterSteps(node);
  const calc = nodeGraphStepRegisterIdeal(node);
  const playing = nodeGraphStepRegisterLivePlaying();
  const fConnected = typeof nodeGraphModuleScopeConnectionsTo === "function"
    && nodeGraphModuleScopeConnectionsTo(nodeId, "f").length > 0;
  let ideal = calc.ideal;
  let played = Number.NaN;
  let targetHz = fConnected ? Number.NaN : nodeGraphStepRegisterParam(node, "frequency", 220);
  let playedHz = Number.NaN;
  let tick = -1;
  if (playing) {
    const liveIdeal = nodeGraphStepRegisterLive(nodeId, "__Ideal");
    const liveReg = nodeGraphStepRegisterLive(nodeId, "__Register");
    const liveTick = nodeGraphStepRegisterLive(nodeId, "__Tick");
    const liveTarget = nodeGraphStepRegisterLive(nodeId, "__TargetHz");
    const livePlayedHz = nodeGraphStepRegisterLive(nodeId, "__PlayedHz");
    if (Number.isFinite(liveIdeal)) ideal = liveIdeal * calc.maxReg;
    if (Number.isFinite(liveReg)) played = Math.round(liveReg * calc.maxReg);
    if (Number.isFinite(liveTick)) tick = Math.round(liveTick) % length;
    if (Number.isFinite(liveTarget)) targetHz = liveTarget;
    if (Number.isFinite(livePlayedHz)) playedHz = livePlayedHz;
  }
  let center;
  if (source === 2) {
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += steps[i];
    center = Math.round(sum / length);
  } else {
    center = Math.round(ideal);
  }
  return {
    source, length, steps, ideal, played, tick, center, fConnected,
    targetHz, playedHz, minHz: calc.minHz, maxHz: calc.maxHz,
    maxReg: calc.maxReg,
    // Divide: higher register = lower pitch, so index grows downward.
    downward: calc.grid === 0,
  };
}

function nodeGraphStepRegisterLayout(drawW, drawH, length) {
  const padX = Math.max(4, drawW * 0.04);
  const statusH = drawH < 100 ? 36 : 60;
  const padY = statusH + 3;
  const innerW = Math.max(4, drawW - padX * 2);
  const innerH = Math.max(4, drawH - padY - 4);
  const rows = NODE_GRAPH_STEP_REGISTER_HALF_ROWS * 2 + 1;
  return {
    padX, padY, innerW, innerH, rows, statusH,
    colW: innerW / length,
    rowH: innerH / rows,
  };
}

// k = row relative to centre (-8..+8, + = higher register index).
function nodeGraphStepRegisterRowY(layout, k, downward) {
  const H = NODE_GRAPH_STEP_REGISTER_HALF_ROWS;
  const visual = downward ? k : -k; // + = down on screen
  return layout.padY + (visual + H + 0.5) * layout.rowH;
}

function nodeGraphStepRegisterYToRow(layout, y, downward) {
  const H = NODE_GRAPH_STEP_REGISTER_HALF_ROWS;
  const visual = Math.round((y - layout.padY) / layout.rowH - 0.5) - H;
  const k = downward ? visual : -visual;
  return Math.max(-H, Math.min(H, k));
}

function drawNodeGraphStepRegisterDisplay(section) {
  try {
    drawNodeGraphStepRegisterDisplayInner(section);
  } catch (error) {
    console.error("[step-register] draw failed", error?.message || String(error), error);
    if (section) {
      section._stepRegisterForceDraw = true;
      section._stepRegisterLaidOut = false;
    }
  }
}

function drawNodeGraphStepRegisterDisplayInner(section) {
  const nodeId = section?.dataset?.node || section?.closest?.(".dsp-node")?.dataset?.node || "";
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const canvas = section?.querySelector?.(".node-step-register-canvas") || section?.querySelector?.(".node-display-face");
  if (!node || !canvas) return;
  const look = typeof nodeGraphBasicShapeFaceLook === "function"
    ? nodeGraphBasicShapeFaceLook(node)
    : { backgroundPaint: "#020609", strokePaint: "rgba(120, 220, 200, 0.92)", dotPaint: "#ffffff", lineThickness: 2, dotThickness: 5, pixelDensity: 1 };
  const model = nodeGraphStepRegisterModel(nodeId, node);
  const faceMetrics = typeof ensureFaceMetrics === "function" ? ensureFaceMetrics(section, { observe: true }) : null;
  const rawW = faceMetrics ? faceMetrics.cssW : Number(section.clientWidth || 0);
  const rawH = faceMetrics ? faceMetrics.cssH : Number(section.clientHeight || 0);
  const signature = [
    nodeId, model.source, model.length, model.center, model.ideal.toFixed(3),
    model.played, model.tick, model.downward ? 1 : 0, model.steps.slice(0, model.length).join(","),
    model.targetHz.toFixed(2), model.playedHz.toFixed(2), model.minHz.toFixed(2), model.maxHz.toFixed(2),
    look.strokePaint, look.backgroundPaint, String(look.lineThickness), String(look.pixelDensity),
    `${Math.round(rawW)}x${Math.round(rawH)}`,
  ].join("|");
  if (
    section._stepRegisterSignature === signature
    && !section._stepRegisterForceDraw
    && section._stepRegisterLaidOut === true
  ) {
    return;
  }
  if (rawW < 8 || rawH < 8) {
    section._stepRegisterLaidOut = false;
    section._stepRegisterForceDraw = true;
    if (!section._stepRegisterRetryFrame) {
      section._stepRegisterRetryFrame = requestAnimationFrame(() => {
        section._stepRegisterRetryFrame = 0;
        drawNodeGraphStepRegisterDisplay(section);
      });
    }
    return;
  }
  const metrics = typeof nodeGraphCycleLineGlMetrics === "function"
    ? nodeGraphCycleLineGlMetrics(section, canvas, look.pixelDensity)
    : null;
  if (!metrics) return;
  const drawW = metrics.cssWidth;
  const drawH = metrics.cssHeight;
  section._stepRegisterSignature = signature;
  section._stepRegisterForceDraw = false;
  section._stepRegisterLaidOut = true;
  section._stepRegisterGeom = { drawW, drawH };

  const L = nodeGraphStepRegisterLayout(drawW, drawH, model.length);
  const H = NODE_GRAPH_STEP_REGISTER_HALF_ROWS;
  const stroke = look.strokePaint || "rgba(120, 220, 200, 0.92)";
  const polylines = [];
  const line = (x0, y0, x1, y1, color, width) => {
    polylines.push({ points: Float32Array.from([x0, y0, x1, y1]), color, width });
  };
  const x0 = L.padX;
  const x1 = L.padX + L.innerW;
  const below = Number.isFinite(model.minHz) && model.targetHz < model.minHz;
  const above = Number.isFinite(model.maxHz) && model.targetHz > model.maxHz;
  const status = model.source === 2 ? "DRAWN MODE: TARGET UNUSED"
    : model.fConnected && !Number.isFinite(model.targetHz) ? "WAITING FOR ƒ"
    : below ? "BELOW GRID: RAISE BITS" : above ? "ABOVE GRID" : "IN RANGE";
  const alert = below || above;
  const textPx = drawH < 100 ? 9 : 12;
  const labels = [
    `TARGET ${nodeGraphStepRegisterFormatHz(model.targetHz)} Hz`,
    `GRID ${nodeGraphStepRegisterFormatHz(model.minHz)}-${nodeGraphStepRegisterFormatHz(model.maxHz)} Hz`,
    `PLAYED ${nodeGraphStepRegisterFormatHz(model.playedHz)} Hz  R${Number.isFinite(model.played) ? model.played : "--"}`,
    status,
  ];
  const textColor = [0.8, 0.91, 0.94, 1];
  const texts = labels.map((label, index) => ({
    text: label, x: x0, y: (index + 0.5) * L.statusH / labels.length,
    px: textPx, family: "ui-monospace, monospace", weight: 600,
    align: "left", maxWidth: L.innerW,
    rgba: index === 3 && alert ? [1, 0.55, 0.33, 1] : textColor,
  }));

  // Rows: registers that exist are drawn; out-of-range rows are left dark.
  for (let k = -H; k <= H; k += 1) {
    const reg = model.center + k;
    if (reg < 0 || reg > model.maxReg) continue;
    const y = nodeGraphStepRegisterRowY(L, k, model.downward);
    line(x0, y, x1, y, k === 0 ? "rgba(120, 220, 200, 0.35)" : "rgba(120, 220, 200, 0.12)", k === 0 ? 1.25 : 0.75);
  }
  // Tick columns (faint separators).
  for (let c = 1; c < model.length; c += 1) {
    const x = L.padX + c * L.colW;
    line(x, L.padY, x, L.padY + L.innerH, "rgba(120, 220, 200, 0.08)", 0.75);
  }
  // Playhead column.
  if (model.tick >= 0) {
    const cx = L.padX + (model.tick + 0.5) * L.colW;
    line(cx, L.padY, cx, L.padY + L.innerH, "rgba(255, 255, 255, 0.22)", Math.max(1, L.colW * 0.9));
  }
  // Drawn steps.
  if (model.source !== 0) {
    const barW = Math.max(1.5, Math.min(L.rowH * 0.7, 6));
    for (let c = 0; c < model.length; c += 1) {
      const v = model.steps[c];
      const k = model.source === 1 ? v : v - model.center;
      if (k < -H || k > H) continue;
      const y = nodeGraphStepRegisterRowY(L, k, model.downward);
      const inset = Math.min(2, L.colW * 0.15);
      line(L.padX + c * L.colW + inset, y, L.padX + (c + 1) * L.colW - inset, y, stroke, barW);
    }
  }
  // Ideal pitch (fractional register).
  {
    const k = model.ideal - model.center;
    if (k >= -H - 0.5 && k <= H + 0.5) {
      const y = nodeGraphStepRegisterRowY(L, k, model.downward);
      line(x0, y, x1, y, "rgba(255, 190, 80, 0.85)", 1);
    }
  }
  const dots = [];
  if (Number.isFinite(model.played) && model.tick >= 0) {
    const k = model.played - model.center;
    if (k >= -H && k <= H) {
      dots.push({
        x: L.padX + (model.tick + 0.5) * L.colW,
        y: nodeGraphStepRegisterRowY(L, k, model.downward),
        color: look.dotPaint || "#ffffff",
        radius: Math.max(1.5, Math.min(L.rowH * 0.45, (look.dotThickness || 5) * 0.5)),
      });
    }
  }
  if (typeof nodeGraphGlLinesPresentFrame !== "function") {
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(canvas, "line renderer missing");
    return;
  }
  nodeGraphGlLinesPresentFrame(canvas, {
    cssWidth: drawW,
    cssHeight: drawH,
    background: look.backgroundPaint || "#020609",
    waveKey: signature,
    blur: typeof nodeGraphLineSmoothingPx === "function" ? nodeGraphLineSmoothingPx(look, 1) : 1,
    polylines,
    dots,
    texts,
  });
}

function nodeGraphStepRegisterCommit(nodeId, steps, status) {
  if (!nodeId || typeof cloneNodeGraphPatch !== "function" || typeof commitNodeGraphPatch !== "function") return false;
  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  const patchNode = (patch.nodes || []).find((n) => n.id === nodeId);
  if (!patchNode) return false;
  const next = { steps: steps.slice(0, NODE_GRAPH_STEP_REGISTER_MAX_STEPS) };
  patchNode.stepRegister = next;
  const live = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (live) live.stepRegister = { steps: next.steps.slice() };
  commitNodeGraphPatch(patch, { status: status || "step register lane", faceEdit: true, liveParamsOnly: true });
  return true;
}

function nodeGraphStepRegisterInstallEditing(section, target) {
  let drag = null;
  const pointAt = (event) => {
    const rect = target.getBoundingClientRect();
    const geom = section._stepRegisterGeom;
    if (!geom || rect.width < 1 || rect.height < 1) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * geom.drawW,
      y: ((event.clientY - rect.top) / rect.height) * geom.drawH,
    };
  };
  const apply = (event) => {
    if (!drag) return;
    const p = pointAt(event);
    if (!p) return;
    const L = nodeGraphStepRegisterLayout(section._stepRegisterGeom.drawW, section._stepRegisterGeom.drawH, drag.length);
    if (p.y < L.padY || p.y > L.padY + L.innerH) return;
    const col = Math.floor((p.x - L.padX) / L.colW);
    if (col < 0 || col >= drag.length) return;
    const k = drag.clear ? 0 : nodeGraphStepRegisterYToRow(L, p.y, drag.downward);
    const value = drag.source === 1 ? k : Math.max(0, Math.min(drag.maxReg, drag.center + k));
    if (drag.steps[col] === value) return;
    drag.steps[col] = value;
    drag.changed = true;
    const live = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(drag.nodeId) : null;
    if (live) live.stepRegister = { steps: drag.steps.slice() };
    section._stepRegisterForceDraw = true;
    drawNodeGraphStepRegisterDisplay(section);
  };
  target.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const nodeId = section.dataset.node || "";
    const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
    if (!node) return;
    const model = nodeGraphStepRegisterModel(nodeId, node);
    if (model.source === 0) return; // Auto: lane is a view only
    event.stopPropagation();
    event.preventDefault();
    drag = {
      nodeId,
      source: model.source,
      length: model.length,
      // Freeze the centre for the whole stroke so rows do not slide.
      center: model.center,
      maxReg: model.maxReg,
      downward: model.downward,
      steps: model.steps.slice(),
      clear: event.ctrlKey || event.metaKey,
      changed: false,
    };
    try { target.setPointerCapture(event.pointerId); } catch (_e) { /* ignore */ }
    apply(event);
  });
  target.addEventListener("pointermove", (event) => {
    if (!drag) return;
    event.stopPropagation();
    apply(event);
  });
  const finish = (event) => {
    if (!drag) return;
    event.stopPropagation();
    const done = drag;
    drag = null;
    try { target.releasePointerCapture(event.pointerId); } catch (_e) { /* ignore */ }
    if (done.changed) nodeGraphStepRegisterCommit(done.nodeId, done.steps, "step register lane");
  };
  target.addEventListener("pointerup", finish);
  target.addEventListener("pointercancel", finish);
}
