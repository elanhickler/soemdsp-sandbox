// Crossfade face for t2…t11 (demux: In -> N outs) and 2t…11t (mux: N ins -> Out).
// One cell per numbered port (labels match the jacks, 0…N-1). Cell fill =
// that path's gain right now; every bar fills from the bottom up (0 at the
// bottom, 1 at the top). No playhead cursor. Drawn with the shared WebGL
// line renderer (gl-line-renderer.js), no Canvas2D.
//
// Gains are computed from the live Analog / Digital input rings (visualInputs
// on the defs: the worklet writes the summed cable value every engine
// sample) with the exact gain law of process_transistor /
// process_transistor_mux in native_modules/graph_engine/graph_engine.cpp.

(function initNodeGraphTSeriesCrossfadeFace(global) {
  const roundAway = (x) => (x >= 0 ? Math.trunc(x + 0.5) : Math.trunc(x - 0.5));
  const clamp = (x, lo, hi) => (x < lo ? lo : (x > hi ? hi : x));
  const finite = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

  /** "t4" -> { kind: "demux", lastIndex: 3 }; "5t" -> { kind: "mux", lastIndex: 4 }. */
  function nodeGraphTSeriesCrossfadeKind(type) {
    const t = String(type || "");
    let m = /^t([2-9]|1[01])$/.exec(t);
    if (m) return { kind: "demux", lastIndex: Number(m[1]) - 1 };
    m = /^([2-9]|1[01])t$/.exec(t);
    if (m) return { kind: "mux", lastIndex: Number(m[1]) - 1 };
    return null;
  }

  /**
   * Per-path gains + playhead for one sample, same law as the engine.
   * Returns { gains: number[N], position: number|null, digitalIndex: number|null }.
   */
  function nodeGraphTSeriesCrossfadeState(kind, lastIndex, input = {}) {
    const last = clamp(Math.round(finite(lastIndex)), kind === "mux" ? 1 : 0, 10);
    const count = last + 1;
    const gains = new Array(count).fill(0);
    const hasAnalog = Boolean(input.hasAnalog);
    const hasDigital = Boolean(input.hasDigital);
    const a = hasAnalog ? finite(input.analog) : 0;
    const d = hasDigital ? finite(input.digital) : 0;
    if (kind === "demux") {
      // process_transistor: Analog unit 0..1 -> addr; triangle window per out.
      const u = clamp(a, 0, 1);
      const addr = u * last;
      const idx = roundAway(d);
      const inRange = idx >= 0 && idx <= last;
      for (let i = 0; i < count; i += 1) {
        const digitalGain = hasDigital ? ((i === idx && inRange) ? 1 : 0) : 0;
        const analogGain = hasAnalog ? Math.max(0, 1 - Math.abs(addr - i)) : 0;
        gains[i] = digitalGain > analogGain ? digitalGain : analogGain;
      }
      return {
        gains,
        position: hasAnalog ? addr : (hasDigital && inRange ? idx : null),
        digitalIndex: hasDigital && inRange ? idx : null,
      };
    }
    // process_transistor_mux.
    if (!hasAnalog && !hasDigital) return { gains, position: null, digitalIndex: null };
    const ac = clamp(a, -1, 1);
    let addr = 0;
    let discrete = false;
    let digitalIndex = null;
    if (hasDigital && !hasAnalog) {
      addr = clamp(roundAway(d), 0, last);
      discrete = true;
      digitalIndex = addr;
    } else if (hasAnalog && !hasDigital) {
      addr = ((ac + 1) * 0.5) * last;
    } else {
      const base = clamp(d, 0, last);
      addr = ac >= 0 ? base + ac * (last - base) : base * (ac + 1);
      digitalIndex = clamp(roundAway(d), 0, last);
    }
    if (discrete) {
      gains[Math.trunc(addr + 0.5)] = 1;
    } else {
      const i0 = clamp(Math.floor(addr), 0, last);
      const i1 = Math.min(i0 + 1, last);
      const frac = clamp(addr - i0, 0, 1);
      gains[i0] += 1 - frac;
      gains[i1] += frac;
    }
    return { gains, position: addr, digitalIndex };
  }

  function latest(nodeId, port) {
    const scope = typeof nodeGraphModuleScopeState !== "undefined" ? nodeGraphModuleScopeState : null;
    const buffer = scope?.buffers?.get?.(`${nodeId}:${port}`);
    if (!buffer?.length) return null;
    for (let i = buffer.length - 1; i >= 0; i -= 1) {
      const v = Number(buffer[i]);
      if (Number.isFinite(v)) return v;
    }
    return null;
  }

  function wired(nodeId, port) {
    return typeof nodeGraphModuleScopeConnectionsTo === "function"
      && nodeGraphModuleScopeConnectionsTo(nodeId, port).length > 0;
  }

  /** Live state for a node: input rings (summed cables) -> engine gain law. */
  function nodeGraphTSeriesCrossfadeLiveState(nodeId, type) {
    const info = nodeGraphTSeriesCrossfadeKind(type);
    if (!info) return null;
    const hasAnalog = wired(nodeId, "Analog");
    const hasDigital = wired(nodeId, "Digital");
    const state = nodeGraphTSeriesCrossfadeState(info.kind, info.lastIndex, {
      hasAnalog,
      hasDigital,
      analog: hasAnalog ? latest(nodeId, "Analog") : 0,
      digital: hasDigital ? latest(nodeId, "Digital") : 0,
    });
    return { ...info, ...state };
  }

  // Palette: demux cool cyan, mux warm amber.
  const HUES = { demux: [0.36, 0.86, 1.0], mux: [1.0, 0.72, 0.28] };
  const CELL = [0.10, 0.115, 0.13, 1];
  const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1];

  /**
   * Draw a crossfade picture into a gl-line batch (CSS px, y down).
   * Exposed for the probe; the face calls it with live state.
   */
  function nodeGraphTSeriesCrossfadePaint(batch, w, h, state) {
    const n = state.gains.length;
    const hue = HUES[state.kind] || HUES.demux;
    const pad = Math.max(1, Math.round(Math.min(w, h) * 0.08));
    const gap = Math.max(1, Math.round(w / n * 0.08));
    const cw = (w - pad * 2) / n;
    const top = pad;
    const cellH = h - pad * 2;
    const fontPx = Math.max(7, Math.min(cellH * 0.55, cw * 0.62));
    for (let i = 0; i < n; i += 1) {
      const g = clamp(finite(state.gains[i]), 0, 1);
      const x = pad + i * cw + gap * 0.5;
      const bw = Math.max(1, cw - gap);
      nodeGraphGlLinesRect(batch, x, top, bw, cellH, CELL);
      if (g > 0.002) {
        const fh = cellH * g;
        const fill = mixRgb([0.16, 0.2, 0.24], hue, 0.35 + 0.65 * g);
        nodeGraphGlLinesRect(batch, x, top + cellH - fh, bw, fh, fill);
      }
      if (state.digitalIndex === i) {
        // Digital selection: bright edge on the top of the bar.
        const edge = Math.max(1, Math.round(h * 0.06));
        nodeGraphGlLinesRect(batch, x, top, bw, edge, [1, 1, 1, 0.85]);
      }
      // Dark digit on a mostly-full cell, light tinted digit otherwise (reads on
      // both the empty cell and a half fill).
      const ink = g > 0.55 ? [0.04, 0.05, 0.06, 1] : [0.55 + hue[0] * 0.4, 0.55 + hue[1] * 0.4, 0.55 + hue[2] * 0.4, 0.95];
      nodeGraphGlLinesText(batch, String(i), x + bw * 0.5, top + cellH * 0.5, {
        px: fontPx, rgba: ink, align: "center", baseline: "middle", weight: 700,
      });
    }
  }

  // Paint into the module's own face canvas. The scope keeps that canvas in a
  // persistent map and re-appends it (cold plate on spawn / Stop), so a second
  // canvas lost: the GL graph composites every .node-display-canvas in DOM
  // order and the re-appended black plate covered the crossfade picture.
  function canvasForFace(face, slot) {
    let canvas = slot?.scopeElement === face && typeof ensureNodeGraphModuleScopeFaceCanvas === "function"
      ? ensureNodeGraphModuleScopeFaceCanvas(slot, { mode: "tape" })
      : null;
    if (canvas) {
      for (const stale of face.querySelectorAll?.(":scope > .node-t-series-crossfade-canvas") || []) {
        if (stale !== canvas) stale.remove();
      }
      canvas.classList.add("node-t-series-crossfade-canvas");
      return canvas;
    }
    // Detached face (probe screenshots): own canvas.
    canvas = face.querySelector?.(":scope > .node-t-series-crossfade-canvas");
    if (!canvas) {
      canvas = nodeGraphDisplayCanvasCreate("node-t-series-crossfade-canvas");
      canvas.setAttribute("aria-hidden", "true");
      face.append(canvas);
    }
    return canvas;
  }

  function syncCanvas(canvas, face, pixelRatio) {
    const dpr = Math.max(1, nodeGraphFiniteNumber(pixelRatio, nodeGraphDisplayCanvasPixelRatio()));
    const metrics = typeof ensureFaceMetrics === "function" ? ensureFaceMetrics(face, { observe: true }) : null;
    const cssW = metrics ? metrics.cssW : Math.max(1, face.clientWidth || 1);
    const cssH = metrics ? metrics.cssH : Math.max(1, face.clientHeight || 1);
    nodeGraphDisplayCanvasSetBacking(canvas, Math.max(1, Math.round(cssW * dpr)), Math.max(1, Math.round(cssH * dpr)));
    if (face.style && (!face.style.position || face.style.position === "static")) {
      face.style.position = "relative";
    }
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    return { cssW, cssH, dpr };
  }

  function drawNodeGraphTSeriesCrossfadeFaceItem(renderer, item, pixelRatio) {
    const slot = item?.slot;
    const face = item?.screenElement || slot?.scopeElement;
    if (!slot || !face) return;
    const node = typeof nodeGraphModuleScopeNodeForSlot === "function" ? nodeGraphModuleScopeNodeForSlot(slot) : null;
    const type = String(node?.type || slot.type || "");
    const canvas = canvasForFace(face, slot);
    const size = syncCanvas(canvas, face, pixelRatio);
    // Stopped / powered off: black plate like the other signal screens.
    if (typeof scopePaintShouldColdBootFace === "function" && scopePaintShouldColdBootFace(slot.nodeId, slot)) {
      if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
      return;
    }
    const state = item?.tSeriesState || nodeGraphTSeriesCrossfadeLiveState(slot.nodeId, type);
    if (!state) return;
    const batch = nodeGraphGlLinesBegin(canvas, [0, 0, 0, 1], { scale: canvas.width / Math.max(1, size.cssW), publishNodeId: "" });
    if (!batch) {
      nodeGraphDisplayGlFailed(canvas, "t-series crossfade GL begin");
      return;
    }
    nodeGraphTSeriesCrossfadePaint(batch, size.cssW, size.cssH, state);
    if (!nodeGraphGlLinesEnd(batch)) {
      nodeGraphDisplayGlFailed(canvas, "t-series crossfade GL end");
      return;
    }
    face._tSeriesCrossfade = state;
    if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
      nodeGraphModuleScopeMarkScreenLit(face, 1);
    }
  }

  global.nodeGraphTSeriesCrossfadeKind = nodeGraphTSeriesCrossfadeKind;
  global.nodeGraphTSeriesCrossfadeState = nodeGraphTSeriesCrossfadeState;
  global.nodeGraphTSeriesCrossfadeLiveState = nodeGraphTSeriesCrossfadeLiveState;
  global.nodeGraphTSeriesCrossfadePaint = nodeGraphTSeriesCrossfadePaint;
  global.drawNodeGraphTSeriesCrossfadeFaceItem = drawNodeGraphTSeriesCrossfadeFaceItem;
  if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
    nodeGraphModuleScopeCustomRenderers.tSeriesFace = drawNodeGraphTSeriesCrossfadeFaceItem;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { nodeGraphTSeriesCrossfadeKind, nodeGraphTSeriesCrossfadeState };
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
