// Shared display-face helper: the one way a module display gets its face.
//
// A display face is a face box: a plain element (no <canvas>, no 2D bitmap)
// that is the face's zoom-1 layout record. It carries its backing size as
// width / height, and its picture lives only in its face texture on the
// shared device (picture-device.js), keyed by face identity: node id + face
// slot (nodeGraphDisplayFaceKey).
//
// - nodeGraphDisplayCanvasCreate(className): new face box with the module's own
//   class plus the marker class `node-display-face`.
// - nodeGraphDisplayCanvasSize(section, face, options): shared sizing path
//   (backing = layout CSS box x devicePixelRatio, never x workspace zoom; see
//   nodeGraphSizeDisplayCanvas in node-graph-visual-utils.js). Returns
//   { width, height, cssWidth, cssHeight, pixelRatio } or null.
// - nodeGraphDisplayCanvasMark(face): add the marker to an existing face box.
//
// GPU passes composite every face from its face texture (the GL graph,
// Canvas view tiles, screen solo, Mini Canvas); each face quad goes
// nearest-neighbor above 2.5x zoom unless the face pins its filter
// (nodeGraphDisplayCanvasPixelated, nodeGraphGlGraphFacePin).
// Drawing goes through gl-line-renderer.js (shared WebGL2 context) and lands
// in the face texture (nodeGraphSharedGlPresentTarget). Modules do not set
// width / height or read devicePixelRatio themselves.

(function initNodeGraphDisplayCanvas(global) {
  const CLASS = "node-display-face";
  const SELECTOR = `.${CLASS}`;

  function nodeGraphDisplayCanvasMark(face) {
    face?.classList?.add?.(CLASS);
    return face;
  }

  /** A face box: layout record + backing size, picture in its face texture. */
  function nodeGraphDisplayCanvasCreate(className = "") {
    const face = global.document.createElement("div");
    face.className = className ? `${className} ${CLASS}` : CLASS;
    face.setAttribute("aria-hidden", "true");
    face.width = 0;
    face.height = 0;
    return face;
  }

  // Faces outside any module (a detached probe face) have no node id; they
  // get a per-element key that is never reused.
  const looseFaceKeys = new WeakMap();
  let looseFaceCount = 0;

  /**
   * Stable face identity: "<node id>#<face slot>". The slot is the face's
   * data-face-slot when the module names it, else its first class plus its
   * index among same-class faces of that module. Resolved once per face box
   * (data-face-key), so a face box moved into a Canvas tile keeps its key and
   * a face box rebuilt with its module gets the same key back.
   */
  function nodeGraphDisplayFaceKey(face) {
    if (!face || typeof face !== "object") return "";
    const known = face.dataset?.faceKey;
    if (known) return known;
    const host = face.closest?.("[data-node]");
    const nodeId = host?.dataset?.node || "";
    if (!nodeId || !face.dataset) {
      let loose = looseFaceKeys.get(face);
      if (!loose) {
        looseFaceCount += 1;
        loose = `~face${looseFaceCount}`;
        looseFaceKeys.set(face, loose);
      }
      return loose;
    }
    let slot = face.dataset.faceSlot || "";
    if (!slot) {
      const first = String(face.className || "").split(/\s+/).find((c) => c && c !== CLASS) || "face";
      let index = 0;
      for (const other of host.querySelectorAll(`.${first}`)) {
        if (other === face) break;
        if (other.closest("[data-node]") === host) index += 1;
      }
      slot = index ? `${first}:${index}` : first;
    }
    const key = `${nodeId}#${slot}`;
    face.dataset.faceKey = key;
    return key;
  }

  function nodeGraphDisplayCanvasSize(section, face, options = {}) {
    if (!section || !face || typeof global.nodeGraphSizeDisplayCanvas !== "function") return null;
    nodeGraphDisplayCanvasMark(face);
    const m = global.nodeGraphSizeDisplayCanvas(section, face, { pixelDensity: 1, ...options });
    if (!m) return null;
    return {
      width: m.width,
      height: m.height,
      cssWidth: m.cssWidth,
      cssHeight: m.cssHeight,
      pixelRatio: m.pixelRatio || 1,
    };
  }

  /**
   * Size from an explicit CSS box (screen solo faces that know their cell). Same
   * rule: backing = css x devicePixelRatio (capped at 2) x density.
   */
  function nodeGraphDisplayCanvasSizeCss(face, cssWidth, cssHeight, density = 1) {
    if (!face || !(cssWidth > 0) || !(cssHeight > 0)) return null;
    nodeGraphDisplayCanvasMark(face);
    const dpr = Math.max(1, Math.min(2, Number(global.devicePixelRatio) || 1));
    const pixelRatio = dpr * Math.max(1e-6, Number(density) || 1);
    const width = Math.max(1, Math.round(cssWidth * pixelRatio));
    const height = Math.max(1, Math.round(cssHeight * pixelRatio));
    if (face.width !== width) face.width = width;
    if (face.height !== height) face.height = height;
    return { width, height, cssWidth, cssHeight, pixelRatio };
  }

  /** devicePixelRatio (>= 1), optionally capped. For faces that size a grid themselves. */
  function nodeGraphDisplayCanvasPixelRatio(cap = Infinity) {
    const dpr = Math.max(1, Number(global.devicePixelRatio) || 1);
    return Math.min(dpr, Math.max(1, Number(cap) || 1));
  }

  /**
   * Set an exact backing size (faces whose GL grid is already computed from
   * the CSS box x nodeGraphDisplayCanvasPixelRatio). Returns true if changed.
   */
  function nodeGraphDisplayCanvasSetBacking(face, width, height) {
    if (!face) return false;
    nodeGraphDisplayCanvasMark(face);
    const w = Math.max(1, Math.round(Number(width) || 1));
    const h = Math.max(1, Math.round(Number(height) || 1));
    if ((face.width | 0) === w && (face.height | 0) === h) return false;
    face.width = w;
    face.height = h;
    return true;
  }

  /**
   * Toggle nearest-neighbour presentation (.display-canvas-pixelated: the
   * face quad is nearest at every zoom). pinSmoothWhenOff: when off, also pin
   * smooth scaling so the quad stays linear above 2.5x zoom
   * (.display-canvas-smooth). nodeGraphGlGraphFacePin reads both.
   */
  function nodeGraphDisplayCanvasPixelated(face, on = true, pinSmoothWhenOff = false) {
    face?.classList?.toggle?.("display-canvas-pixelated", Boolean(on));
    face?.classList?.toggle?.("display-canvas-smooth", !on && Boolean(pinSmoothWhenOff));
    return face;
  }

  /**
   * Bake a glyph atlas (white on black, or white coverage on transparent with
   * options.transparent; one glyph per cell, row-major) into a
   * detached canvas for GL texture upload. The one CPU text raster a module
   * texture may need; nothing is presented from it directly.
   */
  function nodeGraphDisplayCanvasBakeGlyphAtlas(options = {}) {
    const glyphs = options.glyphs || [];
    const cols = Math.max(1, options.cols | 0);
    const count = Math.max(1, options.count | 0 || glyphs.length);
    const rows = Math.max(1, options.rows | 0 || Math.ceil(count / cols));
    const cw = Math.max(1, options.cellW | 0);
    const ch = Math.max(1, options.cellH | 0);
    const canvas = global.document?.createElement?.("canvas");
    if (!canvas) return null;
    canvas.width = cols * cw;
    canvas.height = rows * ch;
    // transparent: white glyph coverage in alpha (no black plate).
    const transparent = Boolean(options.transparent);
    const ctx = canvas.getContext("2d", { alpha: transparent });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
    if (!transparent) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${options.weight || 700} ${Math.max(1, Number(options.fontPx) || ch)}px ${options.family || "monospace"}`;
    // metrics: per-glyph advance + ink bounds ({ width, ascent, descent }) on
    // canvas.glyphMetrics, so faces lay out text without a 2D context.
    if (options.metrics) {
      // Bounds against the alphabetic baseline (measureText's default).
      ctx.textBaseline = "alphabetic";
      canvas.glyphMetrics = [];
      for (let i = 0; i < count; i += 1) {
        const m = ctx.measureText(glyphs[i] || " ");
        canvas.glyphMetrics.push({
          width: Number(m.width) || 0,
          ascent: Number(m.actualBoundingBoxAscent) || 0,
          descent: Number(m.actualBoundingBoxDescent) || 0,
        });
      }
      ctx.textBaseline = "middle";
    }
    if (options.skipDraw) return canvas;
    const yFrac = Number.isFinite(Number(options.yFrac)) ? Number(options.yFrac) : 0.5;
    for (let i = 0; i < count; i += 1) {
      const g = glyphs[i];
      if (!g || g === " ") continue;
      ctx.fillText(g, (i % cols) * cw + cw * 0.5, Math.floor(i / cols) * ch + ch * yFrac);
    }
    return canvas;
  }

  /**
   * High-quality downscale of an <img> into a (reused) detached canvas, for GL
   * texture upload when the source exceeds MAX_TEXTURE_SIZE. Not presented.
   */
  function nodeGraphDisplayCanvasDownscaleImage(img, width, height, reuse = null) {
    const canvas = reuse || global.document?.createElement?.("canvas");
    if (!canvas || !img) return null;
    canvas.width = Math.max(1, width | 0);
    canvas.height = Math.max(1, height | 0);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  // GL failure policy: the face shows black AND the failure is logged once per
  // face + reason with console.error (never a silent fallback).
  const glFailures = new Map();
  function displayFailKey(target) {
    const el = target?.closest ? target : null;
    const node = el?.dataset?.node || el?.closest?.("[data-node]")?.dataset?.node || "";
    const cls = String(target?.className || "").split(/\s+/)[0] || "display";
    return node ? `${node} ${cls}` : cls;
  }
  // One report per display: the first reason is the root cause; follow-on
  // failures of the same face (a copy that then cannot present) stay quiet.
  const failedDisplays = new Set();
  function nodeGraphDisplayGlFailed(target, reason, error = null) {
    const display = displayFailKey(target);
    const key = `${display} | ${reason || "GL failed"}`;
    const isElement = Boolean(target?.closest);
    if (!glFailures.has(key) && !(isElement && failedDisplays.has(display))) {
      if (isElement) failedDisplays.add(display);
      glFailures.set(key, error ? String(error?.message || error) : "");
      if (error) console.error(`[display-gl] ${key}`, error);
      else console.error(`[display-gl] ${key}`);
    }
    if (isElement && typeof global.nodeGraphGlLinesFillBlack === "function") {
      global.nodeGraphGlLinesFillBlack(target);
    }
    return false;
  }
  /** Logged GL failures (key -> message); for smokes / debugging. */
  function nodeGraphDisplayGlFailures() {
    return new Map(glFailures);
  }

  const api = {
    nodeGraphDisplayGlFailed,
    nodeGraphDisplayGlFailures,
    nodeGraphDisplayCanvasBakeGlyphAtlas,
    nodeGraphDisplayCanvasDownscaleImage,
    nodeGraphDisplayCanvasPixelRatio,
    nodeGraphDisplayCanvasSetBacking,
    nodeGraphDisplayCanvasPixelated,
    nodeGraphDisplayFaceKey,
    NODE_GRAPH_DISPLAY_FACE_CLASS: CLASS,
    NODE_GRAPH_DISPLAY_FACE_SELECTOR: SELECTOR,
    nodeGraphDisplayCanvasSizeCss,
    nodeGraphDisplayCanvasMark,
    nodeGraphDisplayCanvasCreate,
    nodeGraphDisplayCanvasSize,
  };
  Object.assign(global, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
