// Shared presenter for one-cycle faces. Coordinates are CSS pixels, origin
// top-left, y down.
//   plots: a signal curve (SinCos, DSF, Basic Shape, Softwave, Ellipsoid), drawn
//     the 1D Plot way: the raw samples go to the GPU sample plot primitive
//     (nodeGraphGlLinesSamplePlot), whose shaders build the segments, the
//     min/max band where samples outnumber pixels, and the jump breaks.
//     { a, b?, mode: "line" | "xy", x, y, w, h, gain, gainY?, offset, span?,
//       shift?, skip?, color, width, blur?, feather? }
//   dots: phase markers, drawn on top.
// Clock / dividers / Logic / Pulse faces use only nodeGraphCycleLineGlMetrics.
// Strokes use the app-wide smootherstep skirt (`feather` or `frame.smoothing`
// CSS px, default 1).

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
  const smoothing = Number.isFinite(Number(frame.smoothing))
    ? Math.max(0, Number(frame.smoothing))
    : (typeof nodeGraphLineSmoothingPx === "function" ? nodeGraphLineSmoothingPx(frame, 1) : 1);
  for (const plot of Array.isArray(frame.plots) ? frame.plots : []) {
    if (!plot?.a?.length || typeof nodeGraphGlLinesSamplePlot !== "function") continue;
    const rgba = nodeGraphGlLinesCss(plot.color || "#ffffff");
    const half = Math.max(0.125, (Number(plot.width) || 1) * 0.5);
    const feather = Number.isFinite(Number(plot.feather)) ? Math.max(0, Number(plot.feather)) : smoothing;
    for (const tap of nodeGraphCycleLineGlBlurTaps(plot.blur)) {
      nodeGraphGlLinesSamplePlot(batch, {
        ...plot,
        x: (Number(plot.x) || 0) + tap.x,
        y: (Number(plot.y) || 0) + tap.y,
        halfPx: half,
        feather,
        rgba: [rgba[0], rgba[1], rgba[2], rgba[3] * tap.w],
      });
    }
  }
  // Dots over the plots (sample plots draw after the base quads).
  batch._over = true;
  for (const dot of Array.isArray(frame.dots) ? frame.dots : []) {
    if (!dot || !Number.isFinite(dot.x) || !Number.isFinite(dot.y)) continue;
    nodeGraphGlLinesDot(batch, dot.x, dot.y, Math.max(0.5, Number(dot.radius) || 0.5), Number.isFinite(Number(dot.feather)) ? Math.max(0, Number(dot.feather)) : smoothing, nodeGraphGlLinesCss(dot.color || "#ffffff"));
  }
  state.waveKey = `${frame.waveKey || ""}|${canvas.width}x${canvas.height}`;
  if (!nodeGraphGlLinesEnd(batch, "alpha")) {
    nodeGraphDisplayGlFailed(canvas, "cycle line: GL present failed");
    return false;
  }
  return true;
}
