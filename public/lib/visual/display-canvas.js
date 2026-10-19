// Shared display-canvas helper: the one way a module display gets its canvas.
//
// - nodeGraphDisplayCanvasCreate(className): new <canvas> with the module's own
//   class plus the marker class `node-display-canvas`.
// - nodeGraphDisplayCanvasSize(section, canvas, options): shared sizing path
//   (backing = layout CSS box x devicePixelRatio, never x workspace zoom; see
//   nodeGraphSizeDisplayCanvas in node-graph-visual-utils.js). Returns
//   { width, height, cssWidth, cssHeight, pixelRatio } or null.
// - nodeGraphDisplayCanvasMark(canvas): add the marker to an existing canvas.
//
// styles.css has ONE rule for zoom pixelation:
//   .node-graph-workspace.pixelated-canvas-zoom .node-display-canvas
// so every display canvas goes nearest-neighbor above 2.5x workspace zoom.
// Drawing goes through gl-line-renderer.js (shared WebGL2 context). Modules do
// not call getContext / set canvas.width / read devicePixelRatio themselves
// (scripts/smoke_test.py check_display_gl_contract).

(function initNodeGraphDisplayCanvas(global) {
  const CLASS = "node-display-canvas";

  function nodeGraphDisplayCanvasMark(canvas) {
    canvas?.classList?.add?.(CLASS);
    return canvas;
  }

  function nodeGraphDisplayCanvasCreate(className = "") {
    const canvas = global.document.createElement("canvas");
    canvas.className = className ? `${className} ${CLASS}` : CLASS;
    return canvas;
  }

  function nodeGraphDisplayCanvasSize(section, canvas, options = {}) {
    if (!section || !canvas || typeof global.nodeGraphSizeDisplayCanvas !== "function") return null;
    nodeGraphDisplayCanvasMark(canvas);
    const m = global.nodeGraphSizeDisplayCanvas(section, canvas, { pixelDensity: 1, ...options });
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
   * Size from an explicit CSS box (F-solo faces that know their cell). Same
   * rule: backing = css x devicePixelRatio (capped at 2) x density.
   */
  function nodeGraphDisplayCanvasSizeCss(canvas, cssWidth, cssHeight, density = 1) {
    if (!canvas || !(cssWidth > 0) || !(cssHeight > 0)) return null;
    nodeGraphDisplayCanvasMark(canvas);
    const dpr = Math.max(1, Math.min(2, Number(global.devicePixelRatio) || 1));
    const pixelRatio = dpr * Math.max(1e-6, Number(density) || 1);
    const width = Math.max(1, Math.round(cssWidth * pixelRatio));
    const height = Math.max(1, Math.round(cssHeight * pixelRatio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return { width, height, cssWidth, cssHeight, pixelRatio };
  }

  /**
   * The face canvas's 2D surface, only for presenting shared-GL output (the
   * *GlPresent(host, ctx, w, h) blits of video-delay-gl / video-feedback-gl,
   * same as gl-line-renderer's own blit). Modules never draw 2D into it.
   */
  function nodeGraphDisplayCanvasPresentContext(canvas) {
    return canvas?.getContext?.("2d") || null;
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
  function nodeGraphDisplayCanvasSetBacking(canvas, width, height) {
    if (!canvas) return false;
    nodeGraphDisplayCanvasMark(canvas);
    const w = Math.max(1, Math.round(Number(width) || 1));
    const h = Math.max(1, Math.round(Number(height) || 1));
    if ((canvas.width | 0) === w && (canvas.height | 0) === h) return false;
    canvas.width = w;
    canvas.height = h;
    return true;
  }

  /**
   * Toggle nearest-neighbour presentation (styles.css .display-canvas-pixelated).
   * pinSmoothWhenOff: when off, also pin smooth scaling so the workspace
   * .pixelated-canvas-zoom rule does not apply (.display-canvas-smooth).
   */
  function nodeGraphDisplayCanvasPixelated(canvas, on = true, pinSmoothWhenOff = false) {
    canvas?.classList?.toggle?.("display-canvas-pixelated", Boolean(on));
    canvas?.classList?.toggle?.("display-canvas-smooth", !on && Boolean(pinSmoothWhenOff));
    return canvas;
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

  /**
   * Copy a shared-GL device region into a face's present context (the one
   * place a module's GL output meets Canvas2D). smooth: bilinear when the
   * copy scales; nearest otherwise.
   */
  function nodeGraphDisplayCanvasBlit(ctx, src, sx, sy, sw, sh, dx, dy, dw, dh, smooth = false) {
    if (!ctx || !src) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    const dev = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
    if (dev?.canvas && src === dev.canvas && typeof nodeGraphSharedGlCopyToContext === "function"
      && nodeGraphSharedGlCopyToContext(ctx, sx, sy, sw, sh, dx, dy, dw, dh, smooth)) {
      return true;
    }
    ctx.imageSmoothingEnabled = Boolean(smooth);
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = smooth ? "medium" : "low";
    ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
    return true;
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
  function nodeGraphDisplayGlFailed(target, reason, error = null) {
    const key = `${displayFailKey(target)} | ${reason || "GL failed"}`;
    if (!glFailures.has(key)) {
      glFailures.set(key, error ? String(error?.message || error) : "");
      if (error) console.error(`[display-gl] ${key}`, error);
      else console.error(`[display-gl] ${key}`);
    }
    const canvas = target && typeof target.getContext === "function" ? target : null;
    if (canvas) {
      if (typeof global.nodeGraphGlLinesFillBlack === "function") {
        global.nodeGraphGlLinesFillBlack(canvas);
      } else {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }
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
    nodeGraphDisplayCanvasBlit,
    nodeGraphDisplayCanvasPixelRatio,
    nodeGraphDisplayCanvasSetBacking,
    nodeGraphDisplayCanvasPixelated,
    nodeGraphDisplayCanvasPresentContext,
    NODE_GRAPH_DISPLAY_CANVAS_CLASS: CLASS,
    nodeGraphDisplayCanvasSizeCss,
    nodeGraphDisplayCanvasMark,
    nodeGraphDisplayCanvasCreate,
    nodeGraphDisplayCanvasSize,
  };
  Object.assign(global, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
