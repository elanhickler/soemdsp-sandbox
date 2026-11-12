// Vactrol face scope: Light, Flt Env, Amp Env, and memory m over the last
// ~2 s. Clinical Expo-edge stroke (same drawer as 1D Plot). Display only.
//
// Amp Env / Flt Env ride the Out / Tone jacks. Memory m is a display-only
// Ramp tap (not an output jack). Light is a display-only Square tap: the
// Light input clamped 0..1 as fed to the cell (not a jack).

const NODE_GRAPH_VACTROL_SCOPE_FACE = Object.freeze({
  historySeconds: 2,
  lineThicknessCss: 1.5,
  legendPx: 9,
  background: [2 / 255, 6 / 255, 9 / 255, 1],
  grid: [127 / 255, 199 / 255, 217 / 255, 0.16],
  light: [197 / 255, 224 / 255, 122 / 255, 1],
  amp: [226 / 255, 168 / 255, 109 / 255, 1],
  flt: [127 / 255, 199 / 255, 217 / 255, 1],
  mem: [200 / 255, 200 / 255, 210 / 255, 0.4],
  dim: 0.4,
});

const nodeGraphVactrolScopeDisplaySettingsDefaults = Object.freeze({
  historySeconds: 2,
  sourceSync: false,
  backgroundColor: "#020609",
  lightColor: "#c5e07a",
  fltEnvColor: "#7fc7d9",
  ampEnvColor: "#e2a86d",
  memColor: "#c8c8d2",
  skipLight: true,
  skipFlt: true,
  skipAmp: true,
  skipMem: true,
  showLight: true,
  showFlt: true,
  showAmp: true,
  showMem: false,
  // Authored CSS px at FACE_INK_REF_PX (96). Paint uses faceInkPx / faceMinSide.
  // 1.5 matches the previous hardcoded lineThicknessCss so old patches look the same.
  lightThickness: 1.5,
  fltThickness: 1.5,
  ampThickness: 1.5,
  memThickness: 1.5,
});

function nodeGraphVactrolScopeToggleOn(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof nodeGraphDisplaySettingsToggleIsOn === "function") {
    return nodeGraphDisplaySettingsToggleIsOn(value);
  }
  return value !== false && value !== 0 && value !== "0" && value !== "false";
}

function nodeGraphVactrolScopeHexToRgb01(hex, fallback) {
  const fb = Array.isArray(fallback) ? fallback : [1, 1, 1];
  const raw = String(hex || "").trim();
  if (typeof nodeGraphScopeHexColorToRgb === "function" && raw) {
    try {
      const rgb = nodeGraphScopeHexColorToRgb(raw);
      if (Array.isArray(rgb) && rgb.length >= 3 && rgb.every((n) => Number.isFinite(Number(n)))) {
        return [Number(rgb[0]), Number(rgb[1]), Number(rgb[2])];
      }
    } catch (err) { /* keep fallback */ }
  }
  const m = /^#?([0-9a-f]{6})$/i.exec(raw);
  if (!m) return [fb[0], fb[1], fb[2]];
  return [0, 2, 4].map((o) => parseInt(m[1].slice(o, o + 2), 16) / 255);
}

function nodeGraphVactrolScopeRgba(hex, fallbackRgba) {
  const fb = Array.isArray(fallbackRgba) ? fallbackRgba : [1, 1, 1, 1];
  const rgb = nodeGraphVactrolScopeHexToRgb01(hex, fb);
  const a = Number.isFinite(Number(fb[3])) ? Number(fb[3]) : 1;
  return [rgb[0], rgb[1], rgb[2], a];
}

function nodeGraphVactrolScopeClampThickness(value, fallback) {
  const fb = Number.isFinite(Number(fallback))
    ? Number(fallback)
    : NODE_GRAPH_VACTROL_SCOPE_FACE.lineThicknessCss;
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(0, Math.min(16, fb));
  return Math.max(0, Math.min(16, n));
}

function nodeGraphVactrolScopeLineThickness(look, key) {
  const d = nodeGraphVactrolScopeDisplaySettingsDefaults;
  return nodeGraphVactrolScopeClampThickness(look?.[key], d[key] ?? NODE_GRAPH_VACTROL_SCOPE_FACE.lineThicknessCss);
}

function normalizeNodeGraphVactrolScopeSettings(settings = {}) {
  const d = nodeGraphVactrolScopeDisplaySettingsDefaults;
  const source = settings && typeof settings === "object" ? settings : {};
  const color = (key, fallbackHex) => {
    const raw = source[key];
    if (raw === undefined || raw === null || raw === "") return fallbackHex;
    if (typeof normalizeNodeGraphTraceDisplayColor === "function") {
      return normalizeNodeGraphTraceDisplayColor(raw, fallbackHex);
    }
    const s = String(raw).trim();
    return /^#?[0-9a-f]{6}$/i.test(s) ? (s[0] === "#" ? s : `#${s}`) : fallbackHex;
  };
  const hist = Number(source.historySeconds ?? source.zoomSeconds ?? d.historySeconds);
  let maxH = Number(typeof nodeGraphTraceDisplayMaxZoomSeconds !== "undefined"
    ? nodeGraphTraceDisplayMaxZoomSeconds
    : 10);
  if (typeof nodeGraphTraceDisplayHistoryControlRange === "function") {
    const range = nodeGraphTraceDisplayHistoryControlRange("historySeconds", "vactrolScope");
    if (Number.isFinite(Number(range?.max)) && Number(range.max) > 0) maxH = Number(range.max);
  }
  const historySeconds = Number.isFinite(hist) && hist > 0
    ? Math.max(0.1, Math.min(maxH, hist))
    : d.historySeconds;
  return {
    historySeconds,
    sourceSync: nodeGraphVactrolScopeToggleOn(source.sourceSync, d.sourceSync),
    backgroundColor: color("backgroundColor", d.backgroundColor),
    lightColor: color("lightColor", d.lightColor),
    fltEnvColor: color("fltEnvColor", d.fltEnvColor),
    ampEnvColor: color("ampEnvColor", d.ampEnvColor),
    memColor: color("memColor", d.memColor),
    skipLight: nodeGraphVactrolScopeToggleOn(source.skipLight, d.skipLight),
    skipFlt: nodeGraphVactrolScopeToggleOn(source.skipFlt, d.skipFlt),
    skipAmp: nodeGraphVactrolScopeToggleOn(source.skipAmp, d.skipAmp),
    skipMem: nodeGraphVactrolScopeToggleOn(source.skipMem, d.skipMem),
    showLight: nodeGraphVactrolScopeToggleOn(source.showLight, d.showLight),
    showFlt: nodeGraphVactrolScopeToggleOn(source.showFlt, d.showFlt),
    showAmp: nodeGraphVactrolScopeToggleOn(source.showAmp, d.showAmp),
    showMem: nodeGraphVactrolScopeToggleOn(source.showMem, d.showMem),
    lightThickness: nodeGraphVactrolScopeClampThickness(source.lightThickness, d.lightThickness),
    fltThickness: nodeGraphVactrolScopeClampThickness(source.fltThickness, d.fltThickness),
    ampThickness: nodeGraphVactrolScopeClampThickness(source.ampThickness, d.ampThickness),
    memThickness: nodeGraphVactrolScopeClampThickness(source.memThickness, d.memThickness),
  };
}

function nodeGraphVactrolScopeSettingsForNode(node) {
  return normalizeNodeGraphVactrolScopeSettings(node?.traceDisplaySettings);
}

function nodeGraphVactrolScopeMergeWrite(node, partial) {
  if (!node) return null;
  const incoming = partial && typeof partial === "object" ? partial : {};
  const prev = node.traceDisplaySettings && typeof node.traceDisplaySettings === "object"
    ? node.traceDisplaySettings
    : {};
  const merged = { ...prev };
  Object.keys(incoming).forEach((key) => {
    if (incoming[key] !== undefined) merged[key] = incoming[key];
  });
  const next = normalizeNodeGraphVactrolScopeSettings(merged);
  if (typeof assignNodeGraphTypedDisplaySettingsToNode === "function") {
    assignNodeGraphTypedDisplaySettingsToNode(node, "vactrolScope", next);
  } else {
    node.traceDisplaySettings = next;
  }
  if (typeof nodeGraphMvp === "object" && nodeGraphMvp) {
    nodeGraphMvp.patchDirtyState = "edited";
  }
  if (typeof persistNodeGraphTraceDisplaySettingsSoon === "function") {
    persistNodeGraphTraceDisplaySettingsSoon("debounce");
  }
  if (typeof recordNodeGraphHistory === "function") {
    recordNodeGraphHistory();
  }
  if (typeof scheduleNodeGraphModuleScopeDraw === "function") {
    scheduleNodeGraphModuleScopeDraw();
  }
  return next;
}

function nodeGraphVactrolScopePortBuffer(nodeId, port) {
  if (typeof nodeGraphPlotPortBuffer === "function") {
    const buf = nodeGraphPlotPortBuffer(nodeId, port);
    if (buf?.length) return buf;
  }
  const own = typeof nodeGraphModuleScopeState !== "undefined"
    ? nodeGraphModuleScopeState.buffers?.get?.(`${nodeId}:${port}`)
    : null;
  return own?.length ? own : null;
}

function nodeGraphVactrolScopeHistorySeconds(look) {
  const raw = Number(look?.historySeconds
    ?? NODE_GRAPH_VACTROL_SCOPE_FACE.historySeconds);
  let maxH = Number(typeof nodeGraphTraceDisplayMaxZoomSeconds !== "undefined"
    ? nodeGraphTraceDisplayMaxZoomSeconds
    : 10);
  if (typeof nodeGraphTraceDisplayHistoryControlRange === "function") {
    const range = nodeGraphTraceDisplayHistoryControlRange("historySeconds", "vactrolScope");
    if (Number.isFinite(Number(range?.max)) && Number(range.max) > 0) maxH = Number(range.max);
  }
  if (!Number.isFinite(raw) || raw <= 0) return NODE_GRAPH_VACTROL_SCOPE_FACE.historySeconds;
  return Math.max(0.1, Math.min(maxH, raw));
}

function nodeGraphVactrolScopeWindow(buffer, seconds) {
  if (!buffer?.length) return null;
  const rate = typeof nodeGraphScopeSampleRate === "function"
    ? nodeGraphScopeSampleRate(buffer)
    : 0;
  const sr = rate > 0 ? rate : 48000;
  const n = Math.min(buffer.length, Math.max(1, Math.ceil(seconds * sr)));
  const start = buffer.length - n;
  return { view: buffer.length === n ? buffer : buffer.subarray(start), spanSeconds: seconds, filled: n / (seconds * sr) };
}

function nodeGraphVactrolScopeDiscThreshold() {
  return typeof nodeGraphModuleScopeDiscontinuityThreshold === "number"
    ? nodeGraphModuleScopeDiscontinuityThreshold
    : 0.85;
}

function nodeGraphVactrolScopePoints(view, filled, x, y, w, h, skip, omitZero) {
  const n = view?.length || 0;
  if (n < 2) return null;
  const pts = [];
  const used = Math.max(0, Math.min(1, filled)) * w;
  const x0 = x + (w - used);
  const thresh = skip ? nodeGraphVactrolScopeDiscThreshold() : 0;
  const zeroFloor = omitZero ? 1e-6 : -Infinity;
  const level = (i) => {
    const v = Number(view[i]);
    return !Number.isFinite(v) ? NaN : (v <= 0 ? 0 : (v >= 1 ? 1 : v));
  };
  let prev = NaN;
  let run = false;
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? 1 : i / (n - 1);
    const s = level(i);
    const px = x0 + t * used;
    const py = y + (1 - (Number.isFinite(s) ? s : 0)) * h;
    // Drop ~0 samples so a resting line does not draw a floor along 0.
    // Skip on: breaking here (NaN,NaN) also avoids a vertical stub at edges.
    // Skip off: a 0 sample next to a raised one stays, so the jump draws
    // down to the floor (gate edges); runs of 0 still draw nothing.
    if (!Number.isFinite(s) || s <= zeroFloor) {
      const edge = !skip && Number.isFinite(s)
        && ((i > 0 && level(i - 1) > zeroFloor) || (i + 1 < n && level(i + 1) > zeroFloor));
      if (edge) {
        pts.push(px, py);
        run = true;
        prev = s;
        continue;
      }
      if (run) { pts.push(NaN, NaN); run = false; }
      prev = NaN;
      continue;
    }
    if (skip && run && Number.isFinite(prev) && Math.abs(s - prev) > thresh) {
      pts.push(NaN, NaN);
      run = false;
    }
    pts.push(px, py);
    run = true;
    prev = s;
  }
  return pts;
}

function nodeGraphVactrolScopeDimRgba(rgba) {
  const d = NODE_GRAPH_VACTROL_SCOPE_FACE.dim;
  return [
    (rgba[0] || 0) * d,
    (rgba[1] || 0) * d,
    (rgba[2] || 0) * d,
    Math.max(0.35, (Number.isFinite(rgba[3]) ? rgba[3] : 1) * 0.7),
  ];
}

function nodeGraphVactrolScopeLegendColor(rgba, on) {
  if (on) {
    return rgba[3] < 0.7 ? [200 / 255, 200 / 255, 210 / 255, 0.85] : rgba;
  }
  return nodeGraphVactrolScopeDimRgba(rgba[3] < 0.7 ? [200 / 255, 200 / 255, 210 / 255, 1] : rgba);
}

function nodeGraphVactrolScopeToggleVisible(nodeId, showKey) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node || !showKey) return;
  const look = nodeGraphVactrolScopeSettingsForNode(node);
  nodeGraphVactrolScopeMergeWrite(node, { [showKey]: !look[showKey] });
}

function nodeGraphVactrolScopeMeasureLegendText(label, legendPx) {
  const measured = typeof nodeGraphGlLinesMeasureText === "function"
    ? Number(nodeGraphGlLinesMeasureText(label, Math.max(1, Math.round(legendPx))))
    : NaN;
  return measured > 0 ? measured : String(label || "").length * legendPx * 0.55;
}

/**
 * Pack legend items into rows so every entry (including Mem) stays inside the
 * face CSS box. The face window uses overflow:hidden, so a single overflowing
 * row used to clip the last items off.
 */
function nodeGraphVactrolScopeLayoutLegend(items, options) {
  const list = Array.isArray(items) ? items : [];
  const x0 = Number(options?.x) || 0;
  const y0 = Number(options?.y) || 0;
  const availW = Math.max(1, Number(options?.availW) || 1);
  const rowH = Math.max(1, Number(options?.rowH) || 1);
  const gap = Math.max(0, Number(options?.gap) || 0);
  const ink = typeof options?.ink === "function" ? options.ink : ((n) => Number(n) || 0);
  const legendPx = Math.max(1, Number(options?.legendPx) || 1);
  const hitPadY = Math.max(ink(4), rowH * 0.35);
  const sw = ink(10);
  const labelGap = ink(4);
  const placed = [];
  let lx = x0;
  let row = 0;
  let rowsUsed = 1;
  for (const item of list) {
    const textW = nodeGraphVactrolScopeMeasureLegendText(item.label, legendPx);
    const width = sw + labelGap + textW;
    if (lx > x0 && (lx - x0) + width > availW) {
      row += 1;
      rowsUsed = row + 1;
      lx = x0;
    }
    const ly = y0 + row * rowH + rowH * 0.45;
    placed.push({
      ...item,
      x: lx,
      y: ly - hitPadY,
      w: width,
      h: hitPadY * 2,
      sw,
      textW,
      ly,
    });
    lx += width + gap;
  }
  return {
    placed,
    rows: rowsUsed,
    height: Math.max(rowH, rowsUsed * rowH),
    sw,
  };
}

function nodeGraphVactrolScopeSyncLegendHits(host, nodeId, hitsCss) {
  if (!host) return;
  let layer = host.querySelector?.(":scope > .node-vactrol-legend-hits");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "node-vactrol-legend-hits";
    layer.setAttribute("role", "list");
    layer.addEventListener("pointerdown", (event) => {
      const item = event.target?.closest?.("[data-vactrol-show-key]");
      if (!item || !layer.contains(item)) return;
      if (event.button && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      nodeGraphVactrolScopeToggleVisible(
        item.getAttribute("data-vactrol-node"),
        item.getAttribute("data-vactrol-show-key"),
      );
    });
    host.appendChild(layer);
  }
  const id = String(nodeId || "");
  const next = Array.isArray(hitsCss) ? hitsCss : [];
  while (layer.childNodes.length > next.length) {
    layer.removeChild(layer.lastChild);
  }
  next.forEach((hit, i) => {
    let el = layer.childNodes[i];
    if (!el) {
      el = document.createElement("button");
      el.type = "button";
      el.setAttribute("role", "listitem");
      layer.appendChild(el);
    }
    el.setAttribute("data-vactrol-show-key", hit.showKey || "");
    el.setAttribute("data-vactrol-node", id);
    el.setAttribute("aria-label", String(hit.label || hit.showKey || "line"));
    el.setAttribute("aria-pressed", hit.show ? "true" : "false");
    el.style.position = "absolute";
    el.style.left = `${hit.x}px`;
    el.style.top = `${hit.y}px`;
    el.style.width = `${Math.max(8, hit.w)}px`;
    el.style.height = `${Math.max(8, hit.h)}px`;
    el.style.margin = "0";
    el.style.padding = "0";
    el.style.border = "0";
    el.style.background = "transparent";
    el.style.cursor = "pointer";
  });
}

function nodeGraphVactrolScopeTraces(look) {
  const F = NODE_GRAPH_VACTROL_SCOPE_FACE;
  return [
    {
      port: "Light",
      label: "Light",
      rgba: nodeGraphVactrolScopeRgba(look.lightColor, F.light),
      show: look.showLight,
      showKey: "showLight",
      thicknessKey: "lightThickness",
      skip: look.skipLight,
      legend: true,
      drawOrder: 0,
    },
    {
      port: "Mem",
      label: "Mem",
      rgba: nodeGraphVactrolScopeRgba(look.memColor, F.mem),
      show: look.showMem,
      showKey: "showMem",
      thicknessKey: "memThickness",
      skip: look.skipMem,
      legend: true,
      drawOrder: 1,
    },
    {
      port: "Tone",
      label: "Flt Env",
      rgba: nodeGraphVactrolScopeRgba(look.fltEnvColor, F.flt),
      show: look.showFlt,
      showKey: "showFlt",
      thicknessKey: "fltThickness",
      skip: look.skipFlt,
      legend: true,
      drawOrder: 2,
    },
    {
      port: "Out",
      label: "Amp Env",
      rgba: nodeGraphVactrolScopeRgba(look.ampEnvColor, F.amp),
      show: look.showAmp,
      showKey: "showAmp",
      thicknessKey: "ampThickness",
      skip: look.skipAmp,
      legend: true,
      drawOrder: 3,
    },
  ];
}

function drawNodeGraphVactrolScopeItem(renderer, item, pixelRatio) {
  if (typeof scopePaintIsFrozen === "function" && scopePaintIsFrozen()) return;
  const slot = item?.slot;
  const nodeId = String(slot?.nodeId || "");
  const node = typeof nodeGraphModuleScopeNodeForSlot === "function"
    ? nodeGraphModuleScopeNodeForSlot(slot)
    : (typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null);
  if (!nodeId) return;
  const canvas = typeof ensureNodeGraphModuleScopeFaceCanvas === "function"
    ? ensureNodeGraphModuleScopeFaceCanvas(slot, { mode: "tape" })
    : null;
  if (typeof nodeGraphWaterfallAbandonTape === "function") nodeGraphWaterfallAbandonTape(canvas);
  const screenElement = item?.screenElement || slot?.scopeElement;
  const synced = typeof syncNodeGraphModuleScopeFaceCanvas === "function"
    ? Boolean(syncNodeGraphModuleScopeFaceCanvas(canvas, screenElement, pixelRatio, 1, { policy: "tape" })?.synced)
    : Boolean(canvas);
  if (!canvas || !synced || typeof nodeGraphGlLinesBegin !== "function") return;
  if (typeof tagNodeGraphModuleScopeFaceCanvas === "function") tagNodeGraphModuleScopeFaceCanvas(canvas, "tape");

  const F = NODE_GRAPH_VACTROL_SCOPE_FACE;
  const look = nodeGraphVactrolScopeSettingsForNode(node);
  const bgHex = look.backgroundColor || "#020609";
  const bgRgba = nodeGraphVactrolScopeRgba(bgHex, F.background);
  if (typeof nodeGraphFacePlateApplyCss === "function") {
    nodeGraphFacePlateApplyCss(screenElement, bgHex);
  }
  // Text is sized below from the face's min side (device px), so the batch
  // adds no tile ink scale of its own.
  const batch = nodeGraphGlLinesBegin(canvas, bgRgba, { textInk: false });
  if (!batch) {
    if (typeof nodeGraphDisplayGlFailed === "function") {
      nodeGraphDisplayGlFailed(canvas, "vactrol scope: GL begin failed");
    }
    return;
  }

  const w = canvas.width;
  const h = canvas.height;
  // Face layout box from the face-metrics cache (ResizeObserver), never a
  // live DOM read: zoom must not force layout. The box is the plate face or
  // the Canvas tile, so strokes, pads and legend scale with min(cssW, cssH)
  // (APP_POLICY 15) and the backing (css x dpr) follows it; zoom never does.
  const box = typeof nodeGraphModuleScopeFaceBackingSize === "function"
    ? nodeGraphModuleScopeFaceBackingSize(screenElement, pixelRatio)
    : null;
  const dpr = Math.max(1, Number(pixelRatio) || 1);
  const cssW = box?.cssWidth > 0 ? box.cssWidth : w / dpr;
  const cssH = box?.cssHeight > 0 ? box.cssHeight : h / dpr;
  const pxScale = w / Math.max(1, cssW);
  const minSide = typeof faceMinSide === "function"
    ? faceMinSide(cssW, cssH)
    : Math.min(cssW, cssH);
  const ink = (cssPx) => (typeof faceInkPx === "function" ? faceInkPx(cssPx, minSide) : cssPx) * pxScale;
  const pad = Math.max(pxScale, ink(4));
  const legendPx = Math.max(6 * pxScale, ink(F.legendPx));
  const traces = nodeGraphVactrolScopeTraces(look);
  const legendOrder = ["Light", "Tone", "Out", "Mem"];
  const byPort = Object.fromEntries(traces.map((tr) => [tr.port, tr]));
  const legendItems = legendOrder.map((port) => byPort[port]).filter(Boolean);
  const legendRowH = Math.ceil(legendPx) + pad;
  const legendLayout = nodeGraphVactrolScopeLayoutLegend(legendItems, {
    x: pad + ink(2),
    y: pad,
    availW: Math.max(1, w - pad * 2 - ink(2)),
    rowH: legendRowH,
    gap: ink(8),
    ink,
    legendPx,
  });
  const legendH = legendLayout.height;
  const x = pad;
  const y = pad + legendH;
  const pw = Math.max(1, w - pad * 2);
  const ph = Math.max(1, h - y - pad);
  const fine = 1;
  const gridHalf = Math.max(0.5, ink(1) * 0.5);
  // Legend swatches stay a readable default width even when a line's thickness is 0.
  const legendHalfPx = Math.max(0.5, ink(F.lineThicknessCss) * 0.5);

  const grid = F.grid;
  nodeGraphGlLinesSegment(batch, x, y + ph, x + pw, y + ph, gridHalf, fine, grid);
  nodeGraphGlLinesSegment(batch, x, y, x, y + ph, gridHalf, fine, grid);
  nodeGraphGlLinesSegment(batch, x, y + ph * 0.5, x + pw, y + ph * 0.5, gridHalf, fine, [grid[0], grid[1], grid[2], 0.1]);

  const seconds = nodeGraphVactrolScopeHistorySeconds(look);
  const byDraw = traces.slice().sort((a, b) => a.drawOrder - b.drawOrder);
  for (const tr of byDraw) {
    if (!tr.show) continue;
    const thickCss = nodeGraphVactrolScopeLineThickness(look, tr.thicknessKey);
    if (!(thickCss > 0)) continue;
    const halfPx = ink(thickCss) * 0.5;
    const buf = nodeGraphVactrolScopePortBuffer(nodeId, tr.port);
    const win = nodeGraphVactrolScopeWindow(buf, seconds);
    if (!win) continue;
    const pts = nodeGraphVactrolScopePoints(win.view, win.filled, x, y, pw, ph, tr.skip, true);
    if (!pts || pts.length < 4) continue;
    if (typeof nodeGraphGlLinesStroke === "function") {
      nodeGraphGlLinesStroke(batch, pts, halfPx, 1, tr.rgba);
    } else {
      nodeGraphGlLinesPolyline(batch, pts, halfPx, 1, tr.rgba);
    }
  }

  // Legend: Light, Flt Env, Amp Env, Mem (labels stand alone; no tooltips).
  // Rows wrap so Mem is not clipped when the face is too narrow for one row.
  const hits = [];
  if (typeof nodeGraphGlLinesText === "function") {
    for (const item of legendLayout.placed) {
      const strokeRgba = item.show ? item.rgba : nodeGraphVactrolScopeDimRgba(item.rgba);
      const textRgba = nodeGraphVactrolScopeLegendColor(item.rgba, item.show);
      nodeGraphGlLinesSegment(batch, item.x, item.ly, item.x + item.sw, item.ly, legendHalfPx, 1, strokeRgba);
      nodeGraphGlLinesText(batch, item.label, item.x + item.sw + ink(4), item.ly, {
        px: legendPx,
        align: "left",
        baseline: "middle",
        rgba: textRgba,
      });
      hits.push({
        x: item.x / pxScale,
        y: item.y / pxScale,
        w: item.w / pxScale,
        h: item.h / pxScale,
        showKey: item.showKey,
        label: item.label,
        show: item.show,
      });
    }
  }
  canvas._vactrolLegendHits = hits;
  nodeGraphVactrolScopeSyncLegendHits(screenElement || canvas.parentElement, nodeId, hits);

  if (!nodeGraphGlLinesEnd(batch, "alpha") && typeof nodeGraphDisplayGlFailed === "function") {
    nodeGraphDisplayGlFailed(canvas, "vactrol scope: GL present failed");
  }
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.vactrolScope = drawNodeGraphVactrolScopeItem;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    drawNodeGraphVactrolScopeItem,
    normalizeNodeGraphVactrolScopeSettings,
    nodeGraphVactrolScopeSettingsForNode,
    nodeGraphVactrolScopeDisplaySettingsDefaults,
    nodeGraphVactrolScopeClampThickness,
    nodeGraphVactrolScopeLineThickness,
    nodeGraphVactrolScopeLayoutLegend,
    nodeGraphVactrolScopeMeasureLegendText,
  };
}
