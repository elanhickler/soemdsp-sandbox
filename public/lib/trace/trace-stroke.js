// Instant (non-phosphor) TRACE stroke helpers — VECTOR philosophy.
//
// TRACE ≠ PHOSPHOR:
//   • Trace: continuous polyline in face space (layout×dpr). No pixel density.
//   • Phosphor: energy deposits on a density-scaled pixel grid.
// Do not add strip-chart scroll or density knobs here — that drifts concepts.
//
// Not burn: no energy FBO, no decay, no bleed. Clear + redraw each frame.
// History plot: brightness scales ink. Blur is stroke softness.
// Size = 0–1 of face min side: 0 → 1px, 1 → full side (exponential).

(function initTraceStroke(global) {
  function clamp01(value, fallback = 0) {
    return globalThis.SoemMath.clamp01(value, fallback);
  }

  function normalizeBlur(value, fallback = 0.2) {
    if (typeof global.PhosphorDrawer?.normalizeBlur === "function") {
      return global.PhosphorDrawer.normalizeBlur(value, fallback);
    }
    let v = Number(value);
    if (!Number.isFinite(v)) {
      v = Number(fallback);
    }
    if (!Number.isFinite(v)) {
      return 0.2;
    }
    if (v < 0) {
      v = (Math.max(-1, v) + 1) * 0.5;
    }
    return Math.max(0, Math.min(1, v));
  }

  /**
   * Diameter in buffer px — linear size × face min side.
   * Size 0 → 0 (trace vanishes). No 1px floor (sub-pixel is allowed).
   * Phosphor stamps keep their own 1px floor; do not share that helper.
   */
  function diameterPx(faceMinSide, size01) {
    return faceInkPx(clampAuthoredInkPx(size01, 0), faceMinSide);
  }

  function radiusPx(faceMinSide, size01) {
    return diameterPx(faceMinSide, size01) * 0.5;
  }

  /**
   * Radial intensity at distance fraction t from centerline (0 center → 1 edge).
   *
   * Curve: raised cosine (half Hann) after a hardness knee —
   *   t <= knee:  1
   *   t in (knee, 1]:  0.5 + 0.5·cos(π·u)  with u = (t-knee)/(1-knee)
   *   → falls 1→0 with continuous first derivative (no step/ring).
   *
   * blur 0 → knee≈1 (hard brick). blur 1 → knee≈0 (soft from center).
   */
  function edgeProfile(t, blur01) {
    const soft = clamp01(blur01, 0);
    const x = clamp01(t, 0);
    if (soft < 0.02) {
      return x < 0.999 ? 1 : 0;
    }
    const knee = (1 - soft) * 0.85;
    if (x <= knee) {
      return 1;
    }
    const u = (x - knee) / Math.max(1e-6, 1 - knee);
    return 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));
  }

  /**
   * History fade along the polyline. t=0 oldest, t=1 newest.
   * fade 0 = even ink. fade 1 = oldest gone, newest full.
   * Power ease: linear left the back half of a circle sitting near 50%.
   */
  function fadeWeight(t, fade01) {
    const f = clamp01(fade01, 0);
    if (f <= 0.001) {
      return 1;
    }
    const u = clamp01(t, 0);
    const k = 1 + f * 2.2;
    return (1 - f) + f * Math.pow(u, k);
  }

  /**
   * Cap control points for a path budget (even subsample). Pieces (null breaks) preserved.
   */
  function budgetPoints(points, maxPoints) {
    const src = Array.isArray(points) ? points : [];
    const cap = Math.max(16, Math.floor(nodeGraphFiniteNumber(maxPoints, 2048)));
    if (src.length <= cap) {
      return src;
    }
    // Count real points; if under cap, return as-is.
    let real = 0;
    for (let i = 0; i < src.length; i += 1) {
      if (src[i]) real += 1;
    }
    if (real <= cap) {
      return src;
    }
    // Even pick of real points, keep null breaks when neighbors are kept.
    const step = real / cap;
    const out = [];
    let realIndex = 0;
    let nextKeep = 0;
    let kept = 0;
    for (let i = 0; i < src.length && kept < cap; i += 1) {
      const p = src[i];
      if (!p) {
        if (out.length && out[out.length - 1] !== null) {
          out.push(null);
        }
        continue;
      }
      if (realIndex + 1e-6 >= nextKeep) {
        out.push(p);
        kept += 1;
        nextKeep += step;
      }
      realIndex += 1;
    }
    // Always keep last real point of source
    const last = [...src].reverse().find((p) => p);
    if (last && (out.length === 0 || out[out.length - 1] !== last)) {
      if (out.length && out[out.length - 1] === null) {
        out.pop();
      }
      out.push(last);
    }
    return out;
  }

  /** Suggest max control points from face area. */
  function pointBudget(faceWidth, faceHeight, userBudget) {
    const area = Math.max(1, (nodeGraphFiniteNumber(faceWidth, 1)) * (nodeGraphFiniteNumber(faceHeight, 1)));
    const auto = Math.max(256, Math.min(4096, Math.floor(Math.sqrt(area) * 8)));
    const user = Math.floor(nodeGraphFiniteNumber(userBudget));
    if (user >= 1) {
      return Math.max(1, Math.min(8192, user));
    }
    return auto;
  }

  function parseRgb01(colorOrRgb, fallback = [1, 0, 0]) {
    if (Array.isArray(colorOrRgb) && colorOrRgb.length >= 3) {
      const a = Number(colorOrRgb[0]);
      const b = Number(colorOrRgb[1]);
      const c = Number(colorOrRgb[2]);
      if (a > 1 || b > 1 || c > 1) {
        return [
          clamp01(a / 255, fallback[0]),
          clamp01(b / 255, fallback[1]),
          clamp01(c / 255, fallback[2]),
        ];
      }
      return [clamp01(a, fallback[0]), clamp01(b, fallback[1]), clamp01(c, fallback[2])];
    }
    const hex = String(colorOrRgb || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      return [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255,
      ];
    }
    return fallback.slice();
  }

  /**
   * Meet color for combine mode.
   *
   * Base (classic): C_M = max(0, 1 − C_L − C_R) per channel
   *   → red + blue = green, yellow + cyan = blue, etc.
   *
   * When the complement collapses (e.g. white + blue → black), a hard
   * white fallback used to pop in only at pure white — near-white still
   * painted a black meet stroke. Soft-mix toward screen(C_L, C_R) so the
   * meet never jumps black→white and stays bright when channels cover RGB.
   */
  function meetColorFromPair(leftRgb01, rightRgb01) {
    const cL = parseRgb01(leftRgb01, [1, 0, 0]);
    const cR = parseRgb01(rightRgb01, [0, 0, 1]);
    const comp = [
      Math.max(0, 1 - cL[0] - cR[0]),
      Math.max(0, 1 - cL[1] - cR[1]),
      Math.max(0, 1 - cL[2] - cR[2]),
    ];
    // Screen of the pair — bright continuous fallback when complement is dark.
    const scr = [
      1 - (1 - cL[0]) * (1 - cR[0]),
      1 - (1 - cL[1]) * (1 - cR[1]),
      1 - (1 - cL[2]) * (1 - cR[2]),
    ];
    const luma = 0.2126 * comp[0] + 0.7152 * comp[1] + 0.0722 * comp[2];
    // Keep full classic complement until it dims; ease to screen below ~0.22 luma.
    const T = 0.22;
    let w = luma <= 0 ? 0 : luma >= T ? 1 : luma / T;
    w = w * w * (3 - 2 * w); // smoothstep
    return [
      clamp01(comp[0] * w + scr[0] * (1 - w), 0),
      clamp01(comp[1] * w + scr[1] * (1 - w), 0),
      clamp01(comp[2] * w + scr[2] * (1 - w), 0),
    ];
  }

  const STEREO_BLEND_MODES = Object.freeze([
    "combine",
    "lighter",
    "screen",
    "source-over",
    "multiply",
    "difference",
    "exclusion",
    "xor",
  ]);

  function normalizeStereoBlend(mode) {
    const m = String(mode || "combine").toLowerCase().trim();
    return STEREO_BLEND_MODES.includes(m) ? m : "combine";
  }

  global.TraceStroke = {
    clamp01,
    normalizeBlur,
    fadeWeight,
    diameterPx,
    radiusPx,
    edgeProfile,
    normalizeStereoBlend,
    STEREO_BLEND_MODES,
    meetColorFromPair,
    parseRgb01,
    budgetPoints,
    pointBudget,
  };
})(typeof window !== "undefined" ? window : globalThis);
