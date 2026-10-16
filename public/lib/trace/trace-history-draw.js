// History-plot Trace drawer (Music Player motion, RGB stroke).
// Shared helpers (blend names, colour parse, point thinning). The 2D stroke
// drawers were removed (no callers); faces draw through the shared GL device.

(function initTraceHistoryDraw(global) {
  const BLENDS = Object.freeze([
    "combine",
    "lighter",
    "screen",
    "source-over",
    "multiply",
    "difference",
    "exclusion",
    "xor",
  ]);

  function clamp01(value, fallback = 0) {
    return globalThis.SoemMath.clamp01(value, fallback);
  }

  function hexToRgb(hex, fallback = [255, 51, 51]) {
    const c = globalThis.SoemColor.parse(hex);
    return c ? c.slice(0, 3) : fallback.slice();
  }

  function rgbCss(rgb, alpha = 1) {
    const r = Math.max(0, Math.min(255, Math.round(rgb[0])));
    const g = Math.max(0, Math.min(255, Math.round(rgb[1])));
    const b = Math.max(0, Math.min(255, Math.round(rgb[2])));
    const a = clamp01(alpha, 1);
    return a >= 0.999 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  function normalizeBlend(value, fallback = "source-over") {
    const raw = String(value || "").toLowerCase().trim();
    if (raw === "add") {
      return "lighter";
    }
    if (raw === "over") {
      return "source-over";
    }
    if (BLENDS.includes(raw)) {
      return raw;
    }
    return fallback;
  }

  function thinPoints(points, budget) {
    if (!Array.isArray(points) || !points.length) {
      return [];
    }
    const valid = [];
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        valid.push(p);
      }
    }
    const cap = Math.max(8, Math.round(nodeGraphFiniteNumber(budget, 2048)));
    if (valid.length <= cap) {
      return valid;
    }
    const out = [];
    const step = (valid.length - 1) / Math.max(1, cap - 1);
    for (let i = 0; i < cap; i += 1) {
      out.push(valid[Math.min(valid.length - 1, Math.round(i * step))]);
    }
    return out;
  }

  function faceMinSide(canvas) {
    return Math.max(1, Math.min(nodeGraphFiniteNumber(canvas?.width, 1), nodeGraphFiniteNumber(canvas?.height, 1)));
  }

  global.TraceHistoryDraw = {
    BLENDS,
    clamp01,
    hexToRgb,
    rgbCss,
    normalizeBlend,
    thinPoints,
    faceMinSide,
  };
})(typeof window !== "undefined" ? window : globalThis);
