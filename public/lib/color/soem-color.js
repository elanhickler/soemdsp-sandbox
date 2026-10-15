/**
 * SoemColor -- shared CSS colour parsing for UI/display code.
 * Plain IIFE, no dependencies. Loads early (before boot and display code).
 */
(function initSoemColor(global) {
  "use strict";

  function byte(n) {
    return Math.max(0, Math.min(255, Math.round(n)));
  }

  /**
   * Parse a CSS colour string into [r, g, b, a]: r/g/b are 0..255 integers,
   * a is 0..1. Accepts #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() with
   * commas, and modern space syntax rgb(R G B / A). Percent channels and
   * percent alpha are accepted. Anything else (including missing) -> null,
   * so the caller chooses its own fallback.
   */
  function parse(input) {
    if (input == null) return null;
    const text = String(input).trim().toLowerCase();
    let m = /^#([0-9a-f]{3,8})$/.exec(text);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) {
        h = h.split("").map((c) => c + c).join("");
      }
      if (h.length !== 6 && h.length !== 8) return null;
      const n = (i) => parseInt(h.slice(i, i + 2), 16);
      return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
    }
    m = /^rgba?\(([^)]*)\)$/.exec(text);
    if (!m) return null;
    const body = m[1].trim();
    let channels;
    let alphaText = null;
    if (body.includes(",")) {
      const parts = body.split(",").map((s) => s.trim());
      if (parts.length < 3 || parts.length > 4) return null;
      channels = parts.slice(0, 3);
      if (parts.length === 4) alphaText = parts[3];
    } else {
      const slash = body.split("/");
      if (slash.length > 2) return null;
      channels = slash[0].trim().split(/\s+/);
      if (channels.length !== 3) return null;
      if (slash.length === 2) alphaText = slash[1].trim();
    }
    const rgb = channels.map((s) =>
      s.endsWith("%") ? (parseFloat(s) / 100) * 255 : parseFloat(s));
    if (!rgb.every(Number.isFinite)) return null;
    let a = 1;
    if (alphaText != null) {
      a = alphaText.endsWith("%") ? parseFloat(alphaText) / 100 : parseFloat(alphaText);
      if (!Number.isFinite(a)) return null;
      a = Math.max(0, Math.min(1, a));
    }
    return [byte(rgb[0]), byte(rgb[1]), byte(rgb[2]), a];
  }

  global.SoemColor = { parse };
})(typeof globalThis !== "undefined" ? globalThis : window);
