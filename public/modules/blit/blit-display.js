// BLIT face — ideal integrated BLIT = Si Σsin(kθ)/k bandlimited saw/square
// (AA Gibbs closed form). No leak. Continuous clinical Expo stroke + envelopes.

function createNodeGraphBlitDisplay(nodeId, type = "blit") {
  const id = nodeId && typeof nodeId === "object"
    ? String(nodeId.dataset?.node || nodeId.id || "")
    : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-blit-display node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "blit");
  section.dataset.parameterVisual = "true";
  section.dataset.lightSource = "screen";
  section.dataset.lightStrength = "0.66";
  const canvas = nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-blit-canvas");
  canvas.dataset.lightSource = "screen";
  canvas.dataset.lightStrength = "0.66";
  section.append(canvas);
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `blit:${el.dataset?.node || ""}`,
    forceKey: "_blitForceDraw",
    rafKey: "_blitPlayheadRaf",
    paint: drawNodeGraphBlitDisplay,
    onResize: (el) => {
      if (typeof syncFaceMetrics === "function") syncFaceMetrics(el);
      el._blitLaidOut = false;
    },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      drawNodeGraphBlitDisplay(section);
      section._startFaceLoop?.();
    });
  });
  return section;
}

function nodeGraphBlitLiveParam(node, key, fallback = 0) {
  if (typeof nodeGraphFilterCurveLiveParam === "function") {
    return nodeGraphFilterCurveLiveParam(node, key, fallback);
  }
  const n = Number(node?.params?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

function nodeGraphBlitSampleRate() {
  if (typeof nodeGraphDsfSampleRate === "function") return nodeGraphDsfSampleRate();
  return 48000;
}

/** Ideal integrated BLIT = Si bandlimited saw/square (no leak). */
function nodeGraphBlitMathCycle(params, count) {
  const n = Math.max(16, count | 0);
  const sr = nodeGraphBlitSampleRate();
  const f = Math.max(1e-6, Math.abs(nodeGraphFiniteNumber(params.frequency, 100)));
  const amp = Number.isFinite(params.amplitude) ? params.amplitude : 1;
  const waveform = Math.max(0, Math.min(4, Math.round(nodeGraphFiniteNumber(params.waveform, 0))));
  const N = typeof nodeGraphMathSawHarmonics === "function"
    ? nodeGraphMathSawHarmonics(sr, f)
    : Math.max(1, Math.floor((sr * 0.5) / f));
  let samples;
  if (waveform === 4) {
    samples = new Float64Array(n);
    for (let i = 0; i < n; i += 1) samples[i] = Math.sin((i / (n - 1)) * Math.PI * 2);
  } else if (waveform === 2 && typeof nodeGraphMathGibbsSquareCycle === "function") {
    samples = nodeGraphMathGibbsSquareCycle(N, n);
  } else if (waveform === 3 && typeof nodeGraphMathGibbsSquareCycle === "function") {
    const sq = nodeGraphMathGibbsSquareCycle(N, n);
    samples = new Float64Array(n);
    let mean = 0;
    for (let i = 0; i < n; i += 1) mean += sq[i];
    mean /= n;
    let y = 0;
    const h = 1 / n;
    for (let i = 0; i < n; i += 1) { y += (sq[i] - mean) * h; samples[i] = y; }
    let aMean = 0;
    for (let i = 0; i < n; i += 1) aMean += samples[i];
    aMean /= n;
    for (let i = 0; i < n; i += 1) samples[i] -= aMean;
  } else if (waveform === 1 && typeof nodeGraphMathGibbsSawCycle === "function") {
    samples = nodeGraphMathGibbsSawCycle(N, n);
    for (let i = 0; i < n; i += 1) samples[i] = -samples[i];
  } else {
    samples = typeof nodeGraphMathGibbsSawCycle === "function"
      ? nodeGraphMathGibbsSawCycle(N, n)
      : new Float64Array(n);
  }
  if (typeof nodeGraphMathNormalizePeak === "function") nodeGraphMathNormalizePeak(samples, 1.15);
  if (amp !== 1) {
    for (let i = 0; i < n; i += 1) samples[i] *= amp;
  }
  return samples;
}


function nodeGraphBlitFaceLook(node) {
  if (typeof normalizeNodeGraphRoundShapeFaceSettings === "function") {
    return normalizeNodeGraphRoundShapeFaceSettings(node?.traceDisplaySettings);
  }
  const face = node?.traceDisplaySettings && typeof node.traceDisplaySettings === "object"
    ? node.traceDisplaySettings
    : {};
  return {
    backgroundPaint: String(face.backgroundPaint || face.background || "#020609"),
    strokePaint: String(face.strokePaint || face.strokeColor || "rgba(120, 220, 200, 0.92)"),
    dotPaint: String(face.dotPaint || face.dotColor || "#ffffff"),
    lineThickness: Math.max(0.25, nodeGraphFiniteNumber(face.lineThickness, 2)),
    dotThickness: Math.max(0.25, nodeGraphFiniteNumber(face.dotThickness, 5)),
    pixelDensity: Number.isFinite(Number(face.pixelDensity)) ? Number(face.pixelDensity) : 1,
  };
}

function nodeGraphBlitReadPhase(nodeId, node, section) {
  if (typeof nodeGraphModuleScopeLatestOutputValue === "function") {
    const live = Number(nodeGraphModuleScopeLatestOutputValue(nodeId, "__Phase", Number.NaN));
    if (Number.isFinite(live)) return live - Math.floor(live);
  }
  if (typeof nodeGraphMvp !== "undefined") {
    const stored = Number(nodeGraphMvp?.live?.runtime?.phases?.get?.(nodeId));
    if (Number.isFinite(stored)) {
      const offset = nodeGraphFiniteNumber(nodeGraphBlitLiveParam(node, "phase", 0));
      const phase = stored + offset;
      return phase - Math.floor(phase);
    }
  }
  return Number.NaN;
}

function drawNodeGraphBlitDisplay(section) {
  try {
    drawNodeGraphBlitDisplayInner(section);
  } catch (error) {
    const detail = error && typeof error === "object"
      ? (error.message || error.name || String(error))
      : String(error);
    console.error("[blit] draw failed", detail, error);
    if (section) {
      section._blitForceDraw = true;
      section._blitLaidOut = false;
    }
  }
}

function drawNodeGraphBlitDisplayInner(section) {
  const nodeId = section?.dataset?.node
    || section?.closest?.(".dsp-node")?.dataset?.node
    || "";
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const canvas = section?.querySelector?.(".node-blit-canvas")
    || section?.querySelector?.("canvas");
  if (!node || !canvas) return;

  const look = nodeGraphBlitFaceLook(node);
  const strokeW = look.lineThickness;
  const dotW = look.dotThickness;
  const pixelDensity = look.pixelDensity;
  const frequency = nodeGraphBlitLiveParam(node, "frequency", 100);
  const amplitude = nodeGraphBlitLiveParam(node, "amplitude", 1);
  const waveform = nodeGraphBlitLiveParam(node, "waveform", 0);
  const phaseParam = nodeGraphBlitLiveParam(node, "phase", 0);
  const phaseDot = Math.round(nodeGraphFiniteNumber(node?.params?.phaseDot, 0));
  const signature = [
    "blit",
    String(waveform),
    String(frequency),
    String(amplitude),
    String(phaseParam),
    String(phaseDot),
    String(strokeW),
    look.strokePaint,
    look.backgroundPaint,
    String(nodeGraphBlitSampleRate()),
  ].join("|");

  const faceMetrics = typeof ensureFaceMetrics === "function"
    ? ensureFaceMetrics(section, { observe: true })
    : null;
  const rawW = faceMetrics ? faceMetrics.cssW : Number(section.clientWidth || 0);
  const rawH = faceMetrics ? faceMetrics.cssH : Number(section.clientHeight || 0);
  const livePlaying = typeof nodeGraphRoundShapeLivePlaying === "function"
    ? nodeGraphRoundShapeLivePlaying()
    : true;
  if (
    !livePlaying
    && section._blitSignature === signature
    && !section._blitForceDraw
    && section._blitLaidOut === true
  ) {
    return;
  }
  if (rawW < 8 || rawH < 8) {
    section._blitLaidOut = false;
    section._blitForceDraw = true;
    if (!section._blitRetryFrame) {
      section._blitRetryFrame = requestAnimationFrame(() => {
        section._blitRetryFrame = 0;
        drawNodeGraphBlitDisplay(section);
      });
    }
    return;
  }

  const metrics = typeof nodeGraphCycleLineGlMetrics === "function"
    ? nodeGraphCycleLineGlMetrics(section, canvas, pixelDensity)
    : null;
  if (!metrics) return;
  const drawW = metrics.cssWidth;
  const drawH = metrics.cssHeight;
  section._blitSignature = signature;
  section._blitForceDraw = false;
  section._blitLaidOut = true;

  const strokeInset = strokeW * 0.5 + 1;
  const padX = Math.max(6, drawW * 0.06) + strokeInset;
  const padY = Math.max(6, drawH * 0.12) + strokeInset;
  const innerW = Math.max(4, drawW - padX * 2);
  const innerH = Math.max(4, drawH - padY * 2);
  const midY = padY + innerH * 0.5;
  const halfH = innerH * 0.5;
  const mapX = (phase) => padX + phase * innerW;
  const mapY = (value) => midY - (value / 1.15) * halfH;

  const sr = nodeGraphBlitSampleRate();
  const f = Math.max(1e-6, Math.abs(frequency));
  const harmonics = typeof nodeGraphMathSawHarmonics === "function"
    ? nodeGraphMathSawHarmonics(sr, f)
    : Math.max(1, Math.floor((sr * 0.5) / f));
  const count = typeof nodeGraphMathCycleSampleCount === "function"
    ? nodeGraphMathCycleSampleCount(innerW, harmonics)
    : Math.max(64, Math.min(120000, Math.ceil(Math.max(innerW * 8, Math.min(harmonics, innerW) * 24))));
  const samples = nodeGraphBlitMathCycle({
    frequency: f,
    amplitude,
    waveform,
  }, count);

  const blur = typeof nodeGraphClinicalLineBlur === "number" ? nodeGraphClinicalLineBlur : 1.2;
  let polylines = [];
  let columns = [];
  if (samples?.length && typeof nodeGraphMathCycleClinicalGeom === "function") {
    const geom = nodeGraphMathCycleClinicalGeom(
      samples, mapX, mapY, Math.max(1, Math.floor(innerW)), strokeW, look.strokePaint,
    );
    polylines = geom.polylines;
    columns = geom.columns;
  }

  const dots = [];
  if (phaseDot >= 1) {
    let play = nodeGraphBlitReadPhase(nodeId, node, section);
    if (!Number.isFinite(play)) {
      play = phaseParam - Math.floor(phaseParam);
    }
    play = play - Math.floor(play);
    const idx = Math.min(samples.length - 1, Math.max(0, Math.round(play * (samples.length - 1))));
    const px = mapX(play);
    const py = mapY(samples[idx]);
    if (Number.isFinite(px) && Number.isFinite(py)) {
      dots.push({
        x: px,
        y: py,
        color: look.dotPaint,
        radius: Math.max(0.5, dotW * 0.5),
      });
    }
  }

  if (typeof nodeGraphClinicalLineGlPresent !== "function") {
    if (typeof nodeGraphDisplayGlFailed === "function") {
      nodeGraphDisplayGlFailed(canvas, "clinical line missing");
    }
    return;
  }
  nodeGraphClinicalLineGlPresent(canvas, {
    cssWidth: drawW,
    cssHeight: drawH,
    background: look.backgroundPaint,
    waveKey: signature,
    blur,
    polylines,
    columns,
    dots,
  });
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.blitFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("blitFace", createNodeGraphBlitDisplay);
}
