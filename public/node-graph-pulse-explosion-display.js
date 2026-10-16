// Node-level display for the Pulse Explosion module: draws the probability
// density curve used by rejection sampling (see the "pulseCurve" layout and
// native_modules/pulse_explosion/pulse_explosion.cpp's header comment for the
// shape's derivation) plus dots at the exact pre-calculated pulse positions
// that a trigger with the node's current seed/parameters will actually play.

function createNodeGraphPulseCurveDisplay(nodeId, type) {
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-pulse-curve-display";
  section.dataset.node = nodeId;
  section.dataset.nodeType = type;
  const canvas = document.createElement("canvas");
  canvas.className = "node-filter-curve-canvas node-pulse-curve-canvas node-display-canvas";
  section.append(canvas);
  requestAnimationFrame(() => drawNodeGraphPulseCurveDisplay(section));
  return section;
}

function nodeGraphPulseCurveNodeParams(node) {
  return {
    startTime: nodeGraphFiniteNumber(node?.params?.startTime),
    centerTime: nodeGraphFiniteNumber(node?.params?.centerTime, 0.5),
    endTime: nodeGraphFiniteNumber(node?.params?.endTime, 1),
    timeSpread: nodeGraphFiniteNumber(node?.params?.timeSpread, 0.3),
    numberOfPulses: nodeGraphFiniteNumber(node?.params?.numberOfPulses, 20),
    lowAmplitude: nodeGraphFiniteNumber(node?.params?.lowAmplitude, 0.3),
    highAmplitude: nodeGraphFiniteNumber(node?.params?.highAmplitude, 1),
    seed: nodeGraphFiniteNumber(node?.params?.seed),
  };
}

function drawNodeGraphPulseCurveDisplay(section) {
  const node = nodeGraphPatchNode(section?.dataset?.node || "");
  const canvas = section?.querySelector?.(".node-pulse-curve-canvas");
  if (!node || !canvas) {
    return;
  }
  const metrics = nodeGraphSizeDisplayCanvas(section, canvas);
  if (!metrics) {
    return;
  }
  const { cssHeight: height, cssWidth: width, pixelRatio } = metrics;

  const params = nodeGraphPulseCurveNodeParams(node);
  const safeStart = Math.max(0, params.startTime);
  let safeEnd = params.endTime;
  if (safeEnd <= safeStart) safeEnd = safeStart + 0.001;
  let safeCenter = Math.max(safeStart, Math.min(safeEnd, params.centerTime));
  if (safeCenter <= safeStart) safeCenter = safeStart + 1e-6;
  if (safeCenter >= safeEnd) safeCenter = safeEnd - 1e-6;
  const skew = -0.99 + 1.98 * Math.max(0, Math.min(1, params.timeSpread));
  const span = Math.max(1e-6, safeEnd - safeStart);

  // Native GL face on the shared device; translucent plate, CSS-px coords.
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, [2 / 255, 6 / 255, 9 / 255, 0.88], { scale: pixelRatio, transparent: true })
    : null;
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "pulse curve: no shared GL device");
    return;
  }
  const fine = 1 / Math.max(1, pixelRatio);
  const grid = [127 / 255, 199 / 255, 217 / 255, 0.18];
  for (let line = 0; line <= 4; line += 1) {
    const y = (line / 4) * height;
    nodeGraphGlLinesSegment(batch, 0, y, width, y, 0.5, fine, grid);
  }

  const timeToX = (t) => ((t - safeStart) / span) * width;
  const densityToY = (d) => (1 - Math.max(0, Math.min(1, d))) * height;

  // Guide lines at start / center / end.
  for (const t of [safeStart, safeCenter, safeEnd]) {
    const x = timeToX(t);
    nodeGraphGlLinesSegment(batch, x, 0, x, height, 0.5, fine, [226 / 255, 168 / 255, 109 / 255, 0.5]);
  }

  // Density curve.
  const curve = [];
  for (let x = 0; x < width; x += 1) {
    const t = safeStart + (x / Math.max(1, width - 1)) * span;
    curve.push(x, densityToY(nodeGraphPulseExplosionDensity(t, safeStart, safeCenter, safeEnd, skew)));
  }
  nodeGraphGlLinesPolyline(batch, curve, 0.75, fine, [61 / 255, 224 / 255, 1, 0.95]);

  // Pre-calculated pulse positions: the exact schedule that a trigger with
  // this node's current seed/parameters would produce.
  const schedule = nodeGraphPulseExplosionComputeSchedule(params, nodeGraphPulseExplosionRandomFn(params.seed));
  for (const pulse of schedule.pulses) {
    const x = timeToX(pulse.time);
    const density = nodeGraphPulseExplosionDensity(pulse.time, safeStart, safeCenter, safeEnd, skew);
    nodeGraphGlLinesDot(batch, x, densityToY(density), 2.25 - fine * 0.5, fine, [1, 214 / 255, 102 / 255, 0.92]);
  }

  nodeGraphGlLinesText(batch, `${schedule.pulses.length} pulses${params.seed ? ` · seed ${params.seed}` : ""}`, 8, 14, {
    px: 10, rgba: [229 / 255, 238 / 255, 242 / 255, 0.74], align: "left", baseline: "alphabetic",
    family: "system-ui, sans-serif", weight: 600,
  });
  if (!nodeGraphGlLinesEnd(batch, "alpha")) {
    nodeGraphDisplayGlFailed(canvas, "pulse curve: GL present failed");
  }
}
