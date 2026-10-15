// Ensemble cloud: delay-ms on X, time waterfalls up, pan as red (L) / blue (R).
// Ink sizes follow APP_POLICY §15 (faceInkPx vs face min-edge). Pixel
// density only changes backing store, not authored CSS size.

function normalizeNodeGraphEnsembleCloudSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const n = Number(src.cloudSpeed);
  return {
    cloudSpeed: Number.isFinite(n) ? Math.max(0, Math.min(4, n)) : 0.5,
  };
}

function nodeGraphEnsembleCloudSettings(node) {
  return normalizeNodeGraphEnsembleCloudSettings(node?.traceDisplaySettings);
}

function drawNodeGraphEnsembleCloudItem(_renderer, item, pixelRatio) {
  const nodeId = item?.slot?.nodeId;
  if (!nodeId) {
    return;
  }
  const node = typeof nodeGraphModuleScopeNodeForSlot === "function"
    ? nodeGraphModuleScopeNodeForSlot(item.slot)
    : null;
  // Cloud is a live visual: hold the last painted frame during transport pause.
  // The shared compositor can still be force-invoked for layout/settings work.
  if (typeof scopePaintIsFrozen === "function" && scopePaintIsFrozen()) {
    return;
  }
  // Match the shared Simulation FPS policy when a forced compositor pass lands.
  if (typeof nodeGraphSimFpsRate === "function" && !(nodeGraphSimFpsRate() > 0)) {
    return;
  }
  const settings = nodeGraphEnsembleCloudSettings(node);
  const canvas = typeof nodeGraphModuleScopeLocalFallbackCanvas === "function"
    ? nodeGraphModuleScopeLocalFallbackCanvas(item?.slot)
    : null;
  const screenElement = item?.screenElement || item?.slot?.scopeElement;
  if (!canvas || typeof syncNodeGraphModuleScopeLocalFallbackCanvas !== "function") {
    return;
  }
  const density = typeof nodeGraphFacePlateDensity === "function"
    ? nodeGraphFacePlateDensity(settings, 1)
    : Math.max(0, Math.min(1, Number(settings.pixelDensity) || 1));
  if (!syncNodeGraphModuleScopeLocalFallbackCanvas(canvas, screenElement, pixelRatio, density)) {
    return;
  }
  const delays = typeof nodeGraphDataBus !== "undefined"
    ? nodeGraphDataBus.get(nodeGraphDataBusKey(String(nodeId), "Delays"))
    : null;
  const pans = typeof nodeGraphDataBus !== "undefined"
    ? nodeGraphDataBus.get(nodeGraphDataBusKey(String(nodeId), "Pans"))
    : null;
  const bgHex = "#000000";
  if (typeof nodeGraphFacePlateApplyCss === "function") {
    nodeGraphFacePlateApplyCss(screenElement, bgHex);
  }
  const w = canvas.width;
  const h = canvas.height;
  if (!(w > 0) || !(h > 0)) {
    return;
  }
  const metrics = typeof ensureFaceMetrics === "function"
    ? ensureFaceMetrics(screenElement, { observe: true })
    : null;
  const cssW = Math.max(1, Number(metrics?.cssW) || w);
  const cssH = Math.max(1, Number(metrics?.cssH) || h);
  const minSide = faceMinSide(cssW, cssH);
  const bufPerCss = w / cssW;
  const ink = (px) => Math.max(1, Math.round(faceInkPx(px, minSide) * bufPerCss));
  const speed = Math.max(0, Number(settings.cloudSpeed));
  const rate = ink(1.5) * speed;
  let acc = Number(canvas._ensembleScrollAcc);
  if (!Number.isFinite(acc)) acc = 0;
  acc += rate;
  const scrollPx = Math.floor(acc);
  canvas._ensembleScrollAcc = acc - scrollPx;
  const sparkW = Math.max(2, ink(2));
  const sparkH = Math.max(1, scrollPx);

  // History of spark rows (device px, y = top of row). The old 2D path scrolled
  // the canvas into itself; GL redraws the whole history each frame instead.
  let rows = canvas._ensembleRows;
  if (!Array.isArray(rows) || canvas._ensembleRowsW !== w || canvas._ensembleRowsH !== h) {
    rows = [];
    canvas._ensembleRowsW = w;
    canvas._ensembleRowsH = h;
  }
  if (scrollPx > 0) {
    for (const row of rows) row.y -= scrollPx;
    while (rows.length && rows[0].y + rows[0].h <= 0) rows.shift();
    if (Array.isArray(delays) && delays.length) {
      // Native Delays are delay01 = 0.5 + 0.5 * the pre-Depth bipolar signal.
      // Keep the face independent of the audio Depth parameter.
      const sparks = [];
      for (let i = 0; i < delays.length; i += 1) {
        const x01 = Math.max(0, Math.min(1, Number(delays[i]) || 0));
        const pan = Math.max(0, Math.min(1, Number(pans && pans[i]) || 0.5));
        sparks.push(Math.round(x01 * Math.max(1, w - sparkW)), (242 * (1 - pan)) / 255, (77 + 178 * pan) / 255);
      }
      rows.push({ y: h - scrollPx, h: sparkH, sparks });
    }
  }
  canvas._ensembleRows = rows;
  if (scrollPx <= 0 && canvas._ensembleDrawn) {
    return;
  }
  const batch = typeof nodeGraphGlLinesBegin === "function" ? nodeGraphGlLinesBegin(canvas, [0, 0, 0, 1]) : null;
  if (!batch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  for (const row of rows) {
    const s = row.sparks;
    for (let i = 0; i < s.length; i += 3) {
      nodeGraphGlLinesRect(batch, s[i], row.y, sparkW, row.h, [s[i + 1], 40 / 255, s[i + 2], 1]);
    }
  }
  // "lighter" in the 2D path -> additive blend.
  canvas._ensembleDrawn = nodeGraphGlLinesEnd(batch, "add");
  if (!canvas._ensembleDrawn && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.ensembleCloud = drawNodeGraphEnsembleCloudItem;
}
