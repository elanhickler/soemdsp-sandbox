// 1D Plot / 1D Plot Stereo / 2D Plot: clinical plots.
// One sharp line, antialiased with the app Expo edge, no glow, no labels.
// Draw picks how samples are joined:
//   Discrete      each sample held flat until the next (2D Plot: a dot each)
//   Linear        straight segments between real samples (default)
//   Reconstructed the bandlimited signal between samples (windowed sinc,
//                 32 taps), the curve a DAC plays and a formula face draws
// More than two samples per pixel: every mode shows the min/max band per
// pixel column. Ink (1D plots): Stroke only / Fill only / Fill & stroke, the
// fill running from the curve to its zero line (as 1D Waterfall).
//
// APP_POLICY 3: JS builds the points; the shared stroke in gl-line-renderer
// (nodeGraphGlLinesStroke) draws them, the same line as every other face.
//
// Display Settings `plotFace`: Background / Line (Left / Right) HBS lamps,
// Line thickness + Line blur (face px, scale with zoom), Time (ms), Gain,
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
  plotDraw: "linear",
  barInk: "stroke",
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
  const draw = String(merged.plotDraw || "").toLowerCase();
  out.plotDraw = ["discrete", "linear", "reconstructed"].includes(draw) ? draw : d.plotDraw;
  const ink = String(merged.barInk || "").toLowerCase();
  out.barInk = ["fill", "stroke", "both"].includes(ink) ? ink : d.barInk;
  return out;
}

function nodeGraphPlotFaceSettingsForNode(node) {
  return normalizeNodeGraphPlotFaceSettings(node?.traceDisplaySettings);
}

/** History buffer for one of this node's input ports (newest sample last). */
function nodeGraphPlotPortBuffer(nodeId, port, capturedFallback = null) {
  // A visual sink owns a captured input ring. Do not make that ring contingent
  // on a second, UI-side exact-port connection lookup: aliases and a plan/UI
  // update arriving one frame apart otherwise make a healthy 1D Plot blank.
  const own = typeof nodeGraphModuleScopeState !== "undefined"
    ? nodeGraphModuleScopeState.buffers?.get?.(`${nodeId}:${port}`)
    : null;
  if (own?.length) return own;
  const wired = typeof nodeGraphModuleScopeConnectedSourceBuffer === "function"
    ? nodeGraphModuleScopeConnectedSourceBuffer(nodeId, port)
    : null;
  if (wired?.length) return wired;
  return capturedFallback?.length ? capturedFallback : null;
}

/** Samples floor(start) .. + n + 1 of an end-aligned buffer (common length `length`). */
function nodeGraphPlotWindowView(buffer, length, win) {
  if (!buffer || buffer.length < length) return null;
  const from = buffer.length - length + Math.floor(win.start);
  return buffer.subarray(from, from + win.n + 2);
}

// Reconstructed: windowed sinc, PLOT_SINC_K taps each side (Blackman window).
const PLOT_SINC_K = 16;

function nodeGraphPlotBad(v) {
  return !(v === v) || Math.abs(v) > 1e30;
}

/** Kernel rows for M sub-steps: row j holds h(j / M - m), m = -K + 1 .. K. */
function nodeGraphPlotSincTable(M) {
  const cache = nodeGraphPlotSincTable.cache || (nodeGraphPlotSincTable.cache = new Map());
  if (cache.has(M)) return cache.get(M);
  const K = PLOT_SINC_K;
  const table = new Float64Array(M * 2 * K);
  for (let j = 0; j < M; j += 1) {
    for (let m = -K + 1; m <= K; m += 1) {
      const x = j / M - m;
      let h = 0;
      if (Math.abs(x) < 1e-9) h = 1;
      else if (Math.abs(x) < K) {
        const u = x / K;
        const win = 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
        h = (Math.sin(Math.PI * x) / (Math.PI * x)) * win;
      }
      table[j * 2 * K + (m + K - 1)] = h;
    }
  }
  cache.set(M, table);
  return table;
}

/** Bandlimited value between samples i and i + 1 at sub-step j of M (bad samples count as 0). */
function nodeGraphPlotSincAt(v, n, i, j, table) {
  const K = PLOT_SINC_K;
  const row = j * 2 * K;
  let acc = 0;
  const lo = Math.max(0, i - K + 1);
  const hi = Math.min(n - 1, i + K);
  for (let k = lo; k <= hi; k += 1) {
    const s = v[k];
    if (nodeGraphPlotBad(s)) continue;
    acc += s * table[row + (k - i + K - 1)];
  }
  return acc;
}

/**
 * Stroke points (device px, NaN = break) for one 1D Plot channel.
 * o: { x, y, w, h, gain, offset, skip, span, shift, draw }
 * Returns { points, band, base } - band: per-column [x, yA, yB] when the
 * window holds more than two samples per pixel (min/max band, every draw mode).
 */
function nodeGraphPlotLinePoints(v, o) {
  const n = v ? v.length : 0;
  const yOf = (s) => o.y + o.h * 0.5 - (s * o.gain + o.offset) * o.h * 0.5;
  const xOf = (i) => o.x + o.w * (i - o.shift) / o.span;
  const jump = (a, b) => nodeGraphPlotBad(a) || nodeGraphPlotBad(b) || (o.skip > 0 && Math.abs(b - a) > o.skip);
  const base = yOf(0);
  const out = [];
  const cols = Math.max(1, Math.ceil(o.w));
  if (o.span > cols * 2) {
    // Dense (M4): per pixel column the first, min, max and last sample, each
    // at its true x, joined as one line. Peaks inside a column survive and
    // column-to-column joins keep the real slope (a centre bar plus a flat
    // link read as stairs at high Gain). band: per-column min/max for fills.
    const band = [];
    const colW = o.w / cols;
    let prev = NaN;
    for (let col = 0; col < cols; col += 1) {
      const from = Math.floor(o.shift + col * o.span / cols);
      const to = Math.max(from + 1, Math.min(n, Math.floor(o.shift + (col + 1) * o.span / cols)));
      let first = -1;
      let last = -1;
      let iLo = -1;
      let iHi = -1;
      for (let i = Math.max(0, from); i < to; i += 1) {
        const s = v[i];
        if (nodeGraphPlotBad(s)) continue;
        if (first < 0) first = i;
        last = i;
        if (iLo < 0 || s < v[iLo]) iLo = i;
        if (iHi < 0 || s > v[iHi]) iHi = i;
      }
      if (first < 0) continue;
      const picks = [...new Set([first, iLo, iHi, last])].sort((a, b) => a - b);
      for (const i of picks) {
        if (Number.isFinite(prev) && jump(prev, v[i])) out.push(NaN, NaN);
        out.push(xOf(i), yOf(v[i]));
        prev = v[i];
      }
      band.push(o.x + (col + 0.5) * colW, yOf(v[iLo]), yOf(v[iHi]));
    }
    return { points: out, band, base, colW };
  }
  const draw = o.draw;
  if (draw === "discrete") {
    // Each sample held flat until the next one (a DAC without its filter).
    for (let i = 0; i < n; i += 1) {
      const s = v[i];
      if (nodeGraphPlotBad(s)) { out.push(NaN, NaN); continue; }
      const x = xOf(i);
      if (i > 0 && !nodeGraphPlotBad(v[i - 1])) {
        out.push(x, yOf(v[i - 1]));
        if (jump(v[i - 1], s)) out.push(NaN, NaN);
      }
      out.push(x, yOf(s));
    }
    return { points: out, band: null, base };
  }
  // Points per sample interval: about two per pixel, up to 32.
  const M = draw === "reconstructed" ? Math.max(1, Math.min(32, Math.ceil((2 * o.w) / Math.max(1, o.span)))) : 1;
  if (M <= 1) {
    for (let i = 0; i < n; i += 1) {
      const s = v[i];
      if (nodeGraphPlotBad(s)) { out.push(NaN, NaN); continue; }
      if (i > 0 && jump(v[i - 1], s)) out.push(NaN, NaN);
      out.push(xOf(i), yOf(s));
    }
    return { points: out, band: null, base };
  }
  // Reconstructed: the bandlimited curve through the samples.
  const table = nodeGraphPlotSincTable(M);
  for (let i = 0; i < n; i += 1) {
    const s = v[i];
    if (nodeGraphPlotBad(s)) { out.push(NaN, NaN); continue; }
    out.push(xOf(i), yOf(s));
    if (i + 1 >= n) break;
    if (jump(s, v[i + 1])) { out.push(NaN, NaN); continue; }
    for (let j = 1; j < M; j += 1) {
      out.push(xOf(i + j / M), yOf(nodeGraphPlotSincAt(v, n, i, j, table)));
    }
  }
  return { points: out, band: null, base };
}

/** Stroke points for 2D Plot (X = a, Y = b). Discrete = a dot per sample. */
function nodeGraphPlotXyPoints(a, b, o) {
  const n = Math.min(a ? a.length : 0, b ? b.length : 0);
  const s = Math.min(o.w, o.h) * 0.5;
  const X = (u) => o.x + o.w * 0.5 + u * o.gain * s;
  const Y = (u) => o.y + o.h * 0.5 - u * o.gainY * s;
  const jump = (p, q) => nodeGraphPlotBad(p) || nodeGraphPlotBad(q) || (o.skip > 0 && Math.abs(q - p) > o.skip);
  const out = [];
  if (o.draw === "discrete") {
    for (let i = 0; i < n; i += 1) {
      if (nodeGraphPlotBad(a[i]) || nodeGraphPlotBad(b[i])) continue;
      out.push(X(a[i]), Y(b[i]), NaN, NaN);
    }
    return out;
  }
  const M = o.draw === "reconstructed" ? Math.max(1, Math.min(8, Math.floor(20000 / Math.max(1, n)))) : 1;
  const table = M > 1 ? nodeGraphPlotSincTable(M) : null;
  for (let i = 0; i < n; i += 1) {
    if (nodeGraphPlotBad(a[i]) || nodeGraphPlotBad(b[i])) { out.push(NaN, NaN); continue; }
    if (i > 0 && (jump(a[i - 1], a[i]) || jump(b[i - 1], b[i]))) out.push(NaN, NaN);
    out.push(X(a[i]), Y(b[i]));
    if (!table || i + 1 >= n || jump(a[i], a[i + 1]) || jump(b[i], b[i + 1])) continue;
    for (let j = 1; j < M; j += 1) {
      out.push(X(nodeGraphPlotSincAt(a, n, i, j, table)), Y(nodeGraphPlotSincAt(b, n, i, j, table)));
    }
  }
  return out;
}

/** Fill from the curve to its zero line (Ink Fill / Fill & stroke, 1D plots). */
function nodeGraphPlotFill(batch, line, rgba) {
  if (line.band) {
    const half = line.colW * 0.5;
    for (let i = 0; i < line.band.length; i += 3) {
      const x = line.band[i];
      const top = Math.min(line.base, line.band[i + 1], line.band[i + 2]);
      const bottom = Math.max(line.base, line.band[i + 1], line.band[i + 2]);
      nodeGraphGlLinesRect(batch, x - half, top, half * 2, Math.max(0.5, bottom - top), rgba);
    }
    return;
  }
  let run = [];
  const flush = () => {
    if (run.length >= 4) nodeGraphGlLinesFillUnder(batch, run, line.base, rgba);
    run = [];
  };
  const p = line.points;
  for (let i = 0; i < p.length; i += 2) {
    if (!Number.isFinite(p[i]) || !Number.isFinite(p[i + 1])) { flush(); continue; }
    run.push(p[i], p[i + 1]);
  }
  flush();
}

/** Output module: Mono folded into a Left / Right window view (speaker mix). */
function nodeGraphPlotFoldMono(view, monoView) {
  if (!view || !monoView || view === monoView) return view;
  const n = Math.min(view.length, monoView.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = view[i] + monoView[i];
  return out;
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
  // Output module: the 1D Plot Stereo face with Mono folded into both lines.
  const outputModule = type === "output";
  let a = nodeGraphPlotPortBuffer(nodeId, mono ? "In" : "Left", mono ? item?.buffer : null);
  let b = mono ? null : nodeGraphPlotPortBuffer(nodeId, "Right");
  const m = outputModule ? nodeGraphPlotPortBuffer(nodeId, "Mono") : null;
  if (m?.length) {
    if (!a?.length) a = m;
    if (!b?.length) b = m;
  }
  const trig = nodeGraphPlotPortBuffer(nodeId, "Trig");
  // Width / Smoothness: face px. The backing is the zoom-1 face size (the GL
  // graph scales the texture), so layout width, never the zoomed client rect.
  const laid = canvas.offsetWidth || 0;
  const pxScale = laid > 0 ? canvas.width / laid : 1;
  const halfPx = Math.max(0, look.lineThickness * 0.5 * pxScale);
  const feather = Math.max(0, (typeof nodeGraphLineSmoothingPx === "function" ? nodeGraphLineSmoothingPx(look, 1) : look.lineSmoothing) * pxScale);
  const skip = look.skipDiscontinuities
    ? (typeof nodeGraphModuleScopeDiscontinuityThreshold === "number" ? nodeGraphModuleScopeDiscontinuityThreshold : 0.85)
    : 0;
  const driver = a?.length ? a : b;
  if (driver?.length) {
    const lengths = [a, b, m].filter((x) => x?.length).map((x) => x.length);
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
      const common = { ...rect, skip, gain: look.scale, gainY: look.scale, offset: look.plotOffset, span: win.n, shift, draw: look.plotDraw };
      if (xy) {
        const pts = nodeGraphPlotXyPoints(nodeGraphPlotWindowView(a, length, win), nodeGraphPlotWindowView(b, length, win), common);
        if (halfPx > 0) nodeGraphGlLinesStroke(batch, pts, halfPx, feather, rgbaA);
      } else {
        const fill = look.barInk === "fill" || look.barInk === "both";
        // Line thickness 0 = no line; a fill keeps its hairline edge.
        const stroke = look.barInk !== "fill" && halfPx > 0;
        const lines = [];
        const mView = m?.length ? nodeGraphPlotWindowView(m, length, win) : null;
        const view = (buf) => (m && buf !== m ? nodeGraphPlotFoldMono(nodeGraphPlotWindowView(buf, length, win), mView) : nodeGraphPlotWindowView(buf, length, win));
        if (a?.length) lines.push({ line: nodeGraphPlotLinePoints(view(a), common), rgba: rgbaA });
        if (b?.length) lines.push({ line: nodeGraphPlotLinePoints(view(b), common), rgba: rgbaB });
        // Fill first, then the line(s) on top, channels in order (1D Waterfall).
        for (const l of fill ? lines : []) nodeGraphPlotFill(batch, l.line, l.rgba);
        for (const l of lines) {
          // Fill only: a hairline along the outline antialiases the fill edge.
          if (stroke) nodeGraphGlLinesStroke(batch, l.line.points, halfPx, feather, l.rgba);
          else if (fill && !l.line.band) nodeGraphGlLinesStroke(batch, l.line.points, 0, 0.75 * pxScale, l.rgba);
        }
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
