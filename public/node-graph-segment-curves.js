// Step Graph segment curves — JS source of truth (keep in sync with
// library/include/soemdsp/math/segment_curves.h). Progress p is 0..1;
// skew/contour is -1..+1. Positive skew raises the mid-segment weight
// so every continuous shape bends the same way. Callers blend
// y = y0 + (y1 - y0) * w.
(function (root) {
  var PLANCK = 1e-7;
  var SHAPES = ["linear", "rational", "exponential", "log", "smoothstep", "smootherstep", "hold"];

  function finiteNumber(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max, fallback) {
    var n = finiteNumber(value, fallback);
    return Math.max(min, Math.min(max, n));
  }

  function clamp01(value) {
    return clamp(value, 0, 1, 0);
  }

  function clamp11(value) {
    return clamp(value, -1, 1, 0);
  }

  function softCap(contour) {
    var c = clamp11(contour);
    if (c > 1 - PLANCK) return 1 - PLANCK;
    if (c < -(1 - PLANCK)) return -(1 - PLANCK);
    return c;
  }

  function normalizeShape(value) {
    var shape = String(value || "").trim().toLowerCase();
    if (shape === "logarithmic") return "log";
    if (shape === "smooth") return "smoothstep";
    if (shape === "smoother") return "smootherstep";
    return SHAPES.indexOf(shape) >= 0 ? shape : "rational";
  }

  function shapeFromParam(value) {
    if (Number.isFinite(Number(value)) && String(value).trim() !== "") {
      var index = Math.max(0, Math.min(SHAPES.length - 1, Math.round(Number(value))));
      return SHAPES[index];
    }
    return normalizeShape(value);
  }

  function shapeIndex(value) {
    if (Number.isFinite(Number(value)) && String(value).trim() !== "") {
      return Math.max(0, Math.min(SHAPES.length - 1, Math.round(Number(value))));
    }
    var idx = SHAPES.indexOf(normalizeShape(value));
    return idx >= 0 ? idx : 1;
  }

  function rational01(p, contour) {
    p = clamp01(p);
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    var c = clamp11(contour);
    if (Math.abs(c) < PLANCK) return p;
    return c < 0 ? (p * (1 + c)) / (1 + c * p) : p / (1 - c + c * p);
  }

  function exponential01(p, contour) {
    p = clamp01(p);
    var t = softCap(contour);
    if (Math.abs(t) < PLANCK) return p;
    var a = Math.abs(t);
    var mag = 1.2 + 6.8 * (a / (1 - a * 0.85));
    // +contour raises f(0.5), matching Rational / Log.
    var k = t < 0 ? mag : -mag;
    if (Math.abs(k) < 0.05) return p;
    var denom = Math.exp(k) - 1;
    if (Math.abs(denom) < PLANCK) return p;
    return (Math.exp(k * p) - 1) / denom;
  }

  function logarithmic01(p, contour) {
    p = clamp01(p);
    var t = softCap(contour);
    if (Math.abs(t) < PLANCK) return p;
    var a = Math.abs(t);
    var b = Math.exp(1.2 + 5.5 * (a / (1 - a * 0.85)));
    if (!Number.isFinite(b) || b <= 1 + PLANCK) return p;
    var denom = Math.log(b);
    if (!Number.isFinite(denom) || Math.abs(denom) < PLANCK) return p;
    return t < 0
      ? 1 - Math.log(1 + (1 - p) * (b - 1)) / denom
      : Math.log(1 + p * (b - 1)) / denom;
  }

  function smoothstepRaw01(p) {
    p = clamp01(p);
    return p * p * (3 - 2 * p);
  }

  function smootherstepRaw01(p) {
    p = clamp01(p);
    return p * p * p * (p * (p * 6 - 15) + 10);
  }

  function smoothstep01(p, contour) {
    return smoothstepRaw01(rational01(p, contour));
  }

  function smootherstep01(p, contour) {
    return smootherstepRaw01(rational01(p, contour));
  }

  function hold01(p, contour) {
    p = clamp01(p);
    var c = clamp11(contour);
    return c < 0 ? (p > 0 ? 1 : 0) : (p >= 1 ? 1 : 0);
  }

  function curve01(p, shape, contour) {
    shape = normalizeShape(shape);
    if (shape === "linear") return clamp01(p);
    if (shape === "exponential") return exponential01(p, contour);
    if (shape === "log") return logarithmic01(p, contour);
    if (shape === "smoothstep") return smoothstep01(p, contour);
    if (shape === "smootherstep") return smootherstep01(p, contour);
    if (shape === "hold") return hold01(p, contour);
    return rational01(p, contour);
  }

  function contourFromMidValue(target, shape) {
    shape = normalizeShape(shape);
    var goal = clamp01(target);
    if (shape === "linear") return 0;
    if (shape === "hold") return goal < 0.5 ? 1 : -1;
    var lo = -1;
    var hi = 1;
    var fLo = curve01(0.5, shape, lo);
    var fHi = curve01(0.5, shape, hi);
    if (goal <= fLo) return -1;
    if (goal >= fHi) return 1;
    for (var i = 0; i < 32; i += 1) {
      var mid = 0.5 * (lo + hi);
      if (curve01(0.5, shape, mid) < goal) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  root.NODE_GRAPH_SEGMENT_SHAPES = Object.freeze(SHAPES.slice());
  root.nodeGraphSegmentNormalizeShape = normalizeShape;
  root.nodeGraphSegmentShapeFromParam = shapeFromParam;
  root.nodeGraphSegmentShapeIndex = shapeIndex;
  root.nodeGraphSegmentRational01 = rational01;
  root.nodeGraphSegmentExponential01 = exponential01;
  root.nodeGraphSegmentLogarithmic01 = logarithmic01;
  root.nodeGraphSegmentSmoothstep01 = smoothstep01;
  root.nodeGraphSegmentSmootherstep01 = smootherstep01;
  root.nodeGraphSegmentHold01 = hold01;
  root.nodeGraphSegmentCurve01 = curve01;
  root.nodeGraphSegmentContourFromMidValue = contourFromMidValue;
})(typeof globalThis !== "undefined" ? globalThis : self);
