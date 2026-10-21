// Shared presenter for one-cycle line + phase-dot faces (SinCos, DSF, Basic
// Shape, Ellipsoid, Softwave). Drawn with the app-wide antialiased line drawer
// (gl-line-renderer.js): each line is one joined strip with a ~1 device-px
// soft edge. Coordinates are CSS pixels, origin top-left, y down.

function nodeGraphCycleLineGlMetrics(section, canvas, pixelDensity) {
  if (!section || !canvas) return null;
  const density = typeof nodeGraphResolveDisplayPixelDensity === "function"
    ? nodeGraphResolveDisplayPixelDensity(pixelDensity)
    : (Number.isFinite(Number(pixelDensity)) && Number(pixelDensity) > 0 ? Number(pixelDensity) : 1);
  const face = typeof ensureFaceMetrics === "function"
    ? ensureFaceMetrics(section, { observe: true })
    : null;
  let cssWidth;
  let cssHeight;
  let devicePixelRatio;
  if (face) {
    cssWidth = Math.max(1, face.cssW);
    cssHeight = Math.max(1, face.cssH);
    devicePixelRatio = Math.max(1, face.dpr || window.devicePixelRatio || 1);
  } else {
    devicePixelRatio = window.devicePixelRatio || 1;
    cssWidth = Math.max(1, Number(section.clientWidth || section.offsetWidth || 0));
    cssHeight = Math.max(1, Number(section.clientHeight || section.offsetHeight || 0));
  }
  const width = Math.max(1, Math.round(Math.round(cssWidth * devicePixelRatio) * Math.max(density, 1e-6)));
  const height = Math.max(1, Math.round(Math.round(cssHeight * devicePixelRatio) * Math.max(density, 1e-6)));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  if (density < 0.999) {
    canvas.style.imageRendering = "pixelated";
  } else if (canvas.style.imageRendering === "pixelated") {
    canvas.style.imageRendering = "";
  }
  if (typeof nodeGraphGlLinesBegin !== "function") return null;
  canvas.__cycleLineGl ||= { waveKey: "" };
  return {
    cssWidth,
    cssHeight,
    pixelRatio: devicePixelRatio * Math.max(density, 1e-6),
    width,
    height,
  };
}

function nodeGraphCycleLineGlBlurTaps(blur) {
  const spread = Math.max(0, Number(blur) || 0);
  if (!(spread > 0.02)) {
    return [{ x: 0, y: 0, w: 1 }];
  }
  const taps = [
    { x: 0, y: 0, w: 1 },
    { x: spread, y: 0, w: 0.5 },
    { x: -spread, y: 0, w: 0.5 },
    { x: 0, y: spread, w: 0.5 },
    { x: 0, y: -spread, w: 0.5 },
    { x: spread * 0.707, y: spread * 0.707, w: 0.25 },
    { x: -spread * 0.707, y: spread * 0.707, w: 0.25 },
    { x: spread * 0.707, y: -spread * 0.707, w: 0.25 },
    { x: -spread * 0.707, y: -spread * 0.707, w: 0.25 },
  ];
  let sum = 0;
  for (let i = 0; i < taps.length; i += 1) sum += taps[i].w;
  return taps.map((tap) => ({ x: tap.x, y: tap.y, w: tap.w / sum }));
}

function nodeGraphCycleLineGlStrips(points) {
  const strips = [];
  let current = [];
  const list = Array.isArray(points) ? points : [];
  for (let i = 0; i < list.length; i += 1) {
    const point = list[i];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      if (current.length) strips.push(current);
      current = [];
      continue;
    }
    current.push(point);
  }
  if (current.length) strips.push(current);
  return strips;
}

function nodeGraphCycleLineGlPresent(canvas, frame = {}) {
  const state = canvas && canvas.__cycleLineGl;
  if (!state || typeof nodeGraphGlLinesBegin !== "function") return false;
  const cssWidth = Math.max(1, Number(frame.cssWidth) || 1);
  const scale = Math.max(1e-6, canvas.width / cssWidth);
  const bg = nodeGraphGlLinesCss(frame.background || "#020609");
  const batch = nodeGraphGlLinesBegin(canvas, [bg[0], bg[1], bg[2], 1], { scale });
  if (!batch) {
    nodeGraphDisplayGlFailed(canvas, "cycle line: no shared GL device");
    return false;
  }
  const fine = 1 / scale;
  for (const line of Array.isArray(frame.lines) ? frame.lines : []) {
    const rgba = nodeGraphGlLinesCss(line?.color || "#ffffff");
    const half = Math.max(0.125, (Number(line?.width) || 1) * 0.5);
    const taps = nodeGraphCycleLineGlBlurTaps(line?.blur);
    for (const strip of nodeGraphCycleLineGlStrips(line?.points)) {
      if (strip.length < 2) continue;
      for (const tap of taps) {
        const pts = [];
        for (const pt of strip) pts.push(pt.x + tap.x, pt.y + tap.y);
        nodeGraphGlLinesPolyline(batch, pts, half, fine, [rgba[0], rgba[1], rgba[2], rgba[3] * tap.w]);
      }
    }
  }
  for (const dot of Array.isArray(frame.dots) ? frame.dots : []) {
    if (!dot || !Number.isFinite(dot.x) || !Number.isFinite(dot.y)) continue;
    nodeGraphGlLinesDot(batch, dot.x, dot.y, Math.max(0.5, Number(dot.radius) || 0.5), fine, nodeGraphGlLinesCss(dot.color || "#ffffff"));
  }
  state.waveKey = `${frame.waveKey || ""}|${canvas.width}x${canvas.height}`;
  if (!nodeGraphGlLinesEnd(batch, "alpha")) {
    nodeGraphDisplayGlFailed(canvas, "cycle line: GL present failed");
    return false;
  }
  return true;
}
