// Face metrics helper for cycle / lamp / pulse faces.
// Coordinates are CSS pixels. Drawing moved to clinical-line-gl.js.
// Clock / dividers / Logic / Pulse faces use only nodeGraphCycleLineGlMetrics.
// SinCos / BasicShape / Ellipsoid still call Metrics for canvas sizing.

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
  // Keep the shared GL gate so Metrics-only faces stay dark when GL is missing.
  if (typeof nodeGraphGlLinesBegin !== "function") return null;
  return {
    cssWidth,
    cssHeight,
    pixelRatio: devicePixelRatio * Math.max(density, 1e-6),
    width,
    height,
  };
}
