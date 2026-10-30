// 1D Plot / 1D Plot Stereo / 2D Plot: clinical plots.
// One sharp line, antialiased with the app smootherstep edge, no glow, no
// labels. Data is never smoothed: straight segments between real samples, a
// min/max band per pixel column when there are more samples than pixels.
//
// GPU only (APP_POLICY §3): the window's raw samples go to the
// gl-line-renderer sample plot primitive (nodeGraphGlLinesSamplePlot), whose
// shaders build every segment, band, break and dot. This file only picks the
// window (Sync / Free) and passes the Display Settings look.
//
// Display Settings `plotFace`: Background / Line (Left / Right) HBS lamps,
// Line thickness + Line smoothing (face px, scale with zoom), Time (ms), Gain,
// Offset, Skip (discontinuities), Sync (1D Plot) or Sync Off / Left / Right /
// Mono (1D Plot Stereo, 2D Plot).
//
// Sync / Free and the Time window follow the one scope sync rule in
// lib/visual/scope-sync.js (shared with 1D Trace and 1D Phosphor). Edge source:
// the Trig jack when wired, else the Sync channel.

const nodeGraphPlotFaceDisplaySettingsDefaults = Object.freeze({
  lineHue: 200,
  lineBrightness: 1,
  lineSaturation: 1,
  lineThickness: 1.5,
  lineSmoothing: 1,
  // Right channel of 1D Plot Stereo.
  dotHue: 200,
  dotBrightness: 0.5,
  dotSaturation: 1,
  backgroundHue: 200,
  backgroundBrightness: 0,
  backgroundSaturation: 1,
  windowMode: "cycles",
  windowCycles: 3,
  timeMs: 20,
  scale: 1,
  plotOffset: 0,
  sourceSync: true,
  syncChannel: "left",
  skipDiscontinuities: true,
});

function normalizeNodeGraphPlotFaceSettings(settings = {}) {
  const d = nodeGraphPlotFaceDisplaySettingsDefaults;
  const source = settings && typeof settings === "object" ? settings : {};
  const merged = { ...d, ...source };
  const out = typeof normalizeNodeGraphRoundShapeFaceSettings === "function"
    ? { ...normalizeNodeGraphRoundShapeFaceSettings(merged) }
    : { ...merged };
  const span = (v, lo, hi, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
  };
  const on = (v, fallback) => (typeof nodeGraphDisplaySettingsToggleIsOn === "function"
    ? nodeGraphDisplaySettingsToggleIsOn(v ?? fallback)
    : (v === undefined ? fallback : v !== false && v !== 0 && v !== "0" && v !== "false"));
  Object.assign(out, nodeGraphScopeWindowSettings(merged, d));
  out.scale = span(merged.scale, 0, 16, d.scale);
  out.plotOffset = span(merged.plotOffset, -1, 1, d.plotOffset);
  out.sourceSync = on(merged.sourceSync, d.sourceSync);
  out.skipDiscontinuities = on(merged.skipDiscontinuities, d.skipDiscontinuities);
  const channel = String(merged.syncChannel || "").toLowerCase();
  out.syncChannel = ["off", "left", "right", "mono"].includes(channel) ? channel : d.syncChannel;
  return out;
}

function nodeGraphPlotFaceSettingsForNode(node) {
  return normalizeNodeGraphPlotFaceSettings(node?.traceDisplaySettings);
}

function nodeGraphPlotWired(nodeId, port) {
  return typeof nodeGraphModuleScopeConnectionsTo === "function"
    && nodeGraphModuleScopeConnectionsTo(nodeId, port).length > 0;
}

/** History buffer for one of this node's input ports (newest sample last). */
function nodeGraphPlotPortBuffer(nodeId, port) {
  if (!nodeGraphPlotWired(nodeId, port)) return null;
  const own = typeof nodeGraphModuleScopeState !== "undefined"
    ? nodeGraphModuleScopeState.buffers?.get?.(`${nodeId}:${port}`)
    : null;
  if (own?.length && Math.floor(Number(own.nodeGraphScopeRecentSampleCount)) > 0) return own;
  const wired = typeof nodeGraphModuleScopeConnectedSourceBuffer === "function"
    ? nodeGraphModuleScopeConnectedSourceBuffer(nodeId, port)
    : null;
  if (wired?.length) return wired;
  return own?.length ? own : null;
}

/** Samples floor(start) .. + n + 1 of an end-aligned buffer (common length `length`). */
function nodeGraphPlotWindowView(buffer, length, win) {
  if (!buffer || buffer.length < length) return null;
  const from = buffer.length - length + Math.floor(win.start);
  return buffer.subarray(from, from + win.n + 2);
}

function drawNodeGraphPlotItem(renderer, item, pixelRatio) {
  if (typeof scopePaintIsFrozen === "function" && scopePaintIsFrozen()) return;
  const slot = item?.slot;
  const nodeId = String(slot?.nodeId || "");
  const node = typeof nodeGraphModuleScopeNodeForSlot === "function" ? nodeGraphModuleScopeNodeForSlot(slot) : null;
  if (!nodeId || !node) return;
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
  const look = nodeGraphPlotFaceSettingsForNode(node);
  const css = (paint, fallback) => (typeof nodeGraphGlLinesCss === "function" ? nodeGraphGlLinesCss(paint || fallback) : [1, 1, 1, 1]);
  const bg = css(look.backgroundPaint, "#000000");
  if (typeof nodeGraphFacePlateApplyCss === "function") nodeGraphFacePlateApplyCss(screenElement, look.backgroundPaint || "#000000");
  const batch = nodeGraphGlLinesBegin(canvas, bg);
  if (!batch) {
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(canvas, "plot: GL begin failed");
    return;
  }

  const type = String(node.type || slot?.type || "");
  const mono = type === "plot1d";
  const xy = type === "plot2d";
  const a = nodeGraphPlotPortBuffer(nodeId, mono ? "In" : "Left");
  const b = mono ? null : nodeGraphPlotPortBuffer(nodeId, "Right");
  const trig = nodeGraphPlotPortBuffer(nodeId, "Trig");
  // Width / Smoothness: face px. The backing is the zoom-1 face size (the GL
  // graph scales the texture), so layout width, never the zoomed client rect.
  const laid = canvas.offsetWidth || 0;
  const pxScale = laid > 0 ? canvas.width / laid : 1;
  const halfPx = Math.max(0.125, look.lineThickness * 0.5 * pxScale);
  const feather = Math.max(0, (typeof nodeGraphLineSmoothingPx === "function" ? nodeGraphLineSmoothingPx(look, 1) : look.lineSmoothing) * pxScale);
  const skip = look.skipDiscontinuities
    ? (typeof nodeGraphModuleScopeDiscontinuityThreshold === "number" ? nodeGraphModuleScopeDiscontinuityThreshold : 0.85)
    : 0;
  const driver = a?.length ? a : b;
  if (driver?.length) {
    const lengths = [a, b].filter((x) => x?.length).map((x) => x.length);
    if (xy && !(a?.length && b?.length)) lengths.length = 0;
    const length = lengths.length ? Math.min(...lengths, trig?.length || Infinity) : 0;
    if (length >= 2) {
      const rate = Math.max(1, Number(typeof nodeGraphScopeSampleRate === "function" ? nodeGraphScopeSampleRate(driver) : 48000) || 48000);
      const channel = mono ? "left" : look.syncChannel;
      const sync = mono ? look.sourceSync : channel !== "off";
      // Edge source: Trig when wired; else the chosen channel. Mono sync of two
      // channels uses Left (a sum would be a per-sample JS loop).
      const edge = trig?.length ? trig : (channel === "right" && b?.length ? b : driver);
      const win = nodeGraphScopeSyncWindow(nodeGraphScopeSyncState(canvas), edge, length, {
        settings: look, sampleRate: rate, sync, trigger: Boolean(trig?.length),
      });
      const shift = win.start - Math.floor(win.start);
      const rgbaA = css(look.strokePaint, "#ffffff");
      const rgbaB = css(look.dotPaint, "#2aa8ff");
      const rect = { x: 0, y: 0, w: canvas.width, h: canvas.height };
      const common = { ...rect, halfPx, feather, skip, gain: look.scale, offset: look.plotOffset, span: win.n, shift };
      if (xy) {
        nodeGraphGlLinesSamplePlot(batch, {
          ...common, mode: "xy", a: nodeGraphPlotWindowView(a, length, win), b: nodeGraphPlotWindowView(b, length, win), gainY: look.scale, rgba: rgbaA,
        });
      } else {
        if (a?.length) nodeGraphGlLinesSamplePlot(batch, { ...common, mode: "line", a: nodeGraphPlotWindowView(a, length, win), rgba: rgbaA });
        if (b?.length) nodeGraphGlLinesSamplePlot(batch, { ...common, mode: "line", a: nodeGraphPlotWindowView(b, length, win), rgba: rgbaB });
      }
    }
  }
  if (!nodeGraphGlLinesEnd(batch, "alpha") && typeof nodeGraphDisplayGlFailed === "function") {
    nodeGraphDisplayGlFailed(canvas, "plot: GL present failed");
  }
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.plot = drawNodeGraphPlotItem;
}
