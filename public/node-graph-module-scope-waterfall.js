// 1D Waterfall — WebGL strip chart (mono / stereo / XYZ / RGB).
// Contract: solid filled peak-to-peak columns (min..max Y per column bin).
// Detail below 1: each column is an independent flat rect. That pitch is the
// bar width, not the scroll step. History moves by time (sub-texel uSub).
// Detail 1 (default): neighboring columns share a continuous edge. Values are
// interpolated from the previous column to this one, across frames, and when
// one sample covers many pixels. Sample plateaus stay flat. A smooth sine
// does not become stairs.
// New columns stamp on the RIGHT; history scrolls LEFT. Never redraw the whole
// face — only scroll existing pixels and fill the new column(s) on the right.
// History (seconds) = freerun window across the face. Shorter = faster scroll. At 0 the same scale is one current bar.
// No source sync. A zero-crossing lock fights the scroll+stamp strip.
// 1D Onset is a sweep: each pass restarts the write cursor at x = Position on
// its exact start sample and overwrites column by column; the previous trace stays
// visible ahead of the cursor. The face is History seconds wide, always, so a
// Reset-aligned impulse lands at the same x every pass. Every Reset edge
// starts a pass, in sample order, even several between two paints.
// WebGL history texture. Instant Waterfall only — no Hz dual-path.

function nodeGraphWaterfallNowMs() {
  return (typeof performance !== "undefined" && typeof performance.now === "function")
    ? performance.now()
    : Date.now();
}

/** Epsilon for callers that still ask. Paint does not pause at 0. Do not invent a nonzero window.
 * SSOT const lives in normalize.js (loads first). Do NOT redeclare here — classic
 * scripts share one scope; a second const aborts this whole file (paint ReferenceError).
 */

/**
 * Freerun History window in seconds (Instant Waterfall only).
 * Reads historySeconds only — normalize migrates legacy historyHz once on load.
 * 0 / non-positive = empty window (one current bar). Missing → default 0.25.
 */
function nodeGraphWaterfallHistorySeconds(settings) {
  const n = Number(settings?.historySeconds);
  if (Number.isFinite(n)) {
    // Explicit 0 / non-positive stays 0 (one bar). Do not consult legacy historyHz.
    return n > 0 ? n : 0;
  }
  // Raw bags that skip normalize may still carry historyHz only.
  const hz = Number(settings?.historyHz);
  if (Number.isFinite(hz)) {
    return hz > 0 ? 1 / hz : 0;
  }
  const z = Number(settings?.zoomSeconds);
  if (Number.isFinite(z)) {
    return z > 0 ? z : 0;
  }
  return 0.25;
}

/** 1D Onset Auto Range: on unless explicitly off. */
function nodeGraphOnsetAutoRangeOn(settings) {
  const raw = settings?.autoRange;
  return !(raw === false || raw === 0 || raw === "0" || raw === "false");
}

/** Min..max of every stored sample on the face, or null when there are none. */
function nodeGraphOnsetTraceRange(onset) {
  const traces = onset?.traces;
  if (!traces) return null;
  let lo = Infinity;
  let hi = -Infinity;
  const keys = Object.keys(traces);
  for (let i = 0; i < keys.length; i += 1) {
    const cols = traces[keys[i]]?.columns || [];
    for (let c = 0; c < cols.length; c += 1) {
      const col = cols[c];
      if (!col?.first) continue;
      if (col.min.raw < lo) lo = col.min.raw;
      if (col.max.raw > hi) hi = col.max.raw;
    }
  }
  return hi >= lo ? { lo, hi } : null;
}

function nodeGraphOnsetScanEdges(buffer, fromAbs, toAbs, planck, latch, kind, onHit) {
  let hit = -1;
  if (!buffer || typeof nodeGraphScopeBufferSampleAtAbsoluteFrame !== "function") return hit;
  const from = Math.floor(fromAbs);
  const to = Math.floor(toAbs);
  for (let frame = from; frame < to; frame += 1) {
    const sample = nodeGraphScopeBufferSampleAtAbsoluteFrame(buffer, frame);
    if (sample == null || !Number.isFinite(sample)) continue;
    const hot = Math.abs(sample) > planck;
    if (kind === "reset") {
      if (hot && !latch.hi) {
        hit = frame;
        if (typeof onHit === "function") onHit(frame);
      }
      latch.hi = hot;
    } else if (hot && latch.below) {
      hit = frame;
      latch.below = false;
    } else if (!hot) {
      latch.below = true;
    }
  }
  return hit;
}

/** Unwrapped time position and the on-face x (the pass can wrap at Position). */
function nodeGraphOnsetTraceX(frame, origin, faceSamples, width, startPx) {
  const u = startPx + ((frame - origin) / Math.max(1, faceSamples)) * width;
  let x = u % width;
  if (x < 0) x += width;
  return { u, x };
}

// range { lo, hi }: Auto Range maps lo..hi to the full face height.
function nodeGraphOnsetTraceY(raw, buffer, slot, settings, height, strokePx, range = null) {
  if (range) {
    const pad = Math.min(height * 0.5, Math.max(0, strokePx) * 0.5);
    const span = range.hi - range.lo;
    const t = span > 0 ? (raw - range.lo) / span : 0.5;
    const ry = height - pad - t * (height - pad * 2);
    return Number.isFinite(ry) ? ry : null;
  }
  const live = nodeGraphWaterfallPrepare(buffer, settings) || buffer;
  const amp = nodeGraphWaterfallAmp(live, slot);
  const midY = height * 0.5;
  const halfHeight = nodeGraphWaterfallHalfHeight(height, slot, settings, amp);
  let y = nodeGraphWaterfallY(raw, amp.gain, amp.offset, midY, halfHeight, amp, settings);
  if (!Number.isFinite(y)) return null;
  const inset = Math.min(height * 0.5, Math.max(0, strokePx) * 0.5);
  if (height > 0) y = Math.max(inset, Math.min(height - inset, y));
  return y;
}

/** Each stored column keeps its own pass start, so ink ahead of the cursor stays where it was drawn. */
function nodeGraphOnsetTraceEnsure(onset, key, rgb, buffer, width) {
  if (!onset.traces) onset.traces = Object.create(null);
  let trace = onset.traces[key];
  if (!trace || trace.columns?.length !== width) {
    trace = onset.traces[key] = { columns: new Array(width), rgb, buffer };
  }
  trace.rgb = rgb;
  trace.buffer = buffer;
  return trace;
}

/** Pixel column for an absolute frame. Many audio samples share one column. */
function nodeGraphOnsetTraceColumn(frame, origin, faceSamples, width) {
  const t = (frame - origin) / Math.max(1, faceSamples);
  let p = Math.floor(t * width);
  if (p < 0) p = 0;
  if (p >= width) p = width - 1;
  return p;
}

/**
 * Keep the first sample, the min, the max, and the last, in time order.
 * A 4 second kick is hundreds of samples per pixel. Drawing each one pegs
 * the UI thread. These four still trace the buffer through that pixel.
 */
function nodeGraphOnsetColumnNote(col, frame, raw) {
  const pt = { frame, raw };
  if (!col.first) {
    col.first = pt;
    col.min = pt;
    col.max = pt;
    col.last = pt;
    return;
  }
  col.last = pt;
  if (raw < col.min.raw) col.min = pt;
  if (raw > col.max.raw) col.max = pt;
}

function nodeGraphOnsetColumnPoints(col) {
  if (!col?.first) return [];
  const list = [col.first, col.min, col.max, col.last];
  list.sort((a, b) => a.frame - b.frame);
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const pt = list[i];
    if (!pt) continue;
    if (out.length && out[out.length - 1].frame === pt.frame) continue;
    out.push(pt);
  }
  return out;
}

/**
 * Face points for columns begin..end-1 of one trace, at sub-pixel x from each
 * sample's own frame. Runs break where the pass changes (the new sweep meets
 * the old trace ahead of the cursor) and where the pass wraps at Position.
 */
function nodeGraphOnsetTraceRuns(onset, trace, slot, settings, height, width, faceSamples, startPx, begin, end, strokePx) {
  const runs = [];
  let run = [];
  let prevOrigin = NaN;
  let prevU = NaN;
  const cols = trace.columns || [];
  for (let c = begin; c < end; c += 1) {
    const col = cols[c];
    const pts = nodeGraphOnsetColumnPoints(col);
    if (pts.length && col.origin !== prevOrigin) {
      if (run.length) runs.push(run);
      run = [];
      prevOrigin = col.origin;
      prevU = NaN;
    }
    for (let i = 0; i < pts.length; i += 1) {
      const y = nodeGraphOnsetTraceY(pts[i].raw, trace.buffer, slot, settings, height, strokePx, onset.range);
      if (y == null) continue;
      const loc = nodeGraphOnsetTraceX(pts[i].frame, col.origin, faceSamples, width, startPx);
      if (Number.isFinite(prevU) && Math.floor(loc.u / width) !== Math.floor(prevU / width)) {
        if (run.length) runs.push(run);
        run = [];
      }
      run.push({ x: loc.x, y });
      prevU = loc.u;
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

/**
 * Zoomed in (samples more than a pixel apart): a monotone cubic through the
 * samples, stepped every pixel, so the stroke is a smooth curve with no
 * overshoot past a sample. Zoomed out, the points are already the per-column
 * first / min / max / last envelope at their own x, so peaks never vanish.
 * Returns flat [x0, y0, x1, y1, ...].
 */
function nodeGraphOnsetSmoothRun(run) {
  const n = run.length;
  const out = [];
  if (!n) return out;
  const slope = new Array(Math.max(0, n - 1));
  for (let i = 0; i < n - 1; i += 1) {
    const dx = run[i + 1].x - run[i].x;
    slope[i] = dx > 1e-9 ? (run[i + 1].y - run[i].y) / dx : 0;
  }
  const tan = new Array(n);
  for (let i = 0; i < n; i += 1) {
    if (i === 0) tan[i] = n > 1 ? slope[0] : 0;
    else if (i === n - 1) tan[i] = slope[n - 2];
    else tan[i] = slope[i - 1] * slope[i] <= 0 ? 0 : 2 / (1 / slope[i - 1] + 1 / slope[i]);
  }
  out.push(run[0].x, run[0].y);
  for (let i = 0; i < n - 1; i += 1) {
    const a = run[i];
    const b = run[i + 1];
    const dx = b.x - a.x;
    const steps = dx > 1 ? Math.ceil(dx) : 1;
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const y = (2 * t3 - 3 * t2 + 1) * a.y + (t3 - 2 * t2 + t) * dx * tan[i]
        + (-2 * t3 + 3 * t2) * b.y + (t3 - t2) * dx * tan[i + 1];
      out.push(a.x + dx * t, y);
    }
  }
  return out;
}

/**
 * Draw columns begin..end-1 of every trace into the face texture with the
 * shared antialiased GL line drawer: fill first (outline to the zero line, or
 * to the bottom with Bottom fill), then the stroke, channels in order.
 * clipX0 (canvas px): ink only at x >= clipX0. The strip then starts a few
 * finished columns early so the curve enters it with the right slope.
 */
function nodeGraphOnsetDrawStrip(canvas, onset, keys, slot, settings, height, width, faceSamples, startPx, begin, end, clipX0 = null) {
  const s = canvas?._wfGlSession;
  const fill = nodeGraphWaterfallBarsFilled(settings);
  const stroke = nodeGraphWaterfallDrawStroke(settings);
  if (!s?.gl || !s.read?.fbo || !(end > begin) || (!fill && !stroke)) return;
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, [0, 0, 0, 0], { publishNodeId: "" })
    : null;
  if (!batch || typeof nodeGraphGlLinesDrawInto !== "function") {
    nodeGraphDisplayGlFailed(canvas, "1D Onset: no shared GL device");
    return;
  }
  const strokePx = nodeGraphOnsetStrokeCanvasPx(canvas, settings);
  // Enough finished columns that every segment reaching the clip is redrawn.
  const from = clipX0 == null ? begin : Math.max(0, begin - 2 - Math.ceil(strokePx));
  const curves = [];
  for (let i = 0; i < keys.length; i += 1) {
    const trace = onset.traces?.[keys[i]];
    if (!trace) continue;
    const rgb = trace.rgb || [255, 255, 255, 1];
    const rgba = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, rgb.length > 3 ? rgb[3] : 1];
    const runs = nodeGraphOnsetTraceRuns(onset, trace, slot, settings, height, width, faceSamples, startPx, from, end, strokePx)
      .map(nodeGraphOnsetSmoothRun);
    let base = height;
    if (!nodeGraphWaterfallIsBottomFill(settings)) {
      const zero = nodeGraphOnsetTraceY(0, trace.buffer, slot, settings, height, 0, onset.range);
      base = zero == null ? height * 0.5 : Math.max(0, Math.min(height, zero));
    }
    curves.push({ rgba, runs, base });
  }
  for (let i = 0; fill && i < curves.length; i += 1) {
    const { rgba, runs, base } = curves[i];
    for (const flat of runs) {
      if (flat.length >= 4) nodeGraphGlLinesFillUnder(batch, flat, base, rgba);
      // Fill alone: a hairline feather along the outline antialiases its edge.
      if (!stroke && flat.length >= 4) nodeGraphGlLinesPolyline(batch, flat, 0, 0.75, rgba);
    }
  }
  const half = Math.max(0, strokePx * 0.5 - 0.5);
  for (let i = 0; stroke && i < curves.length; i += 1) {
    const { rgba, runs } = curves[i];
    for (const flat of runs) {
      if (flat.length >= 4) nodeGraphGlLinesPolyline(batch, flat, half, 1, rgba);
      else if (flat.length === 2) nodeGraphGlLinesDot(batch, flat[0], flat[1], half, 1, rgba);
    }
  }
  nodeGraphWaterfallGlFlush(s);
  const gl = s.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.read.fbo);
  gl.viewport(0, 0, s.w, s.h);
  const clip = clipX0 == null ? null : Math.max(0, Math.min(s.w, Math.floor(clipX0)));
  if (clip !== null) {
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(clip, 0, s.w - clip, s.h);
  } else {
    gl.disable(gl.SCISSOR_TEST);
  }
  const ok = nodeGraphGlLinesDrawInto(batch);
  gl.disable(gl.SCISSOR_TEST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) nodeGraphDisplayGlFailed(canvas, "1D Onset: GL draw failed");
}

function nodeGraphOnsetRedrawTraces(canvas, onset, slot, settings, height, width, faceSamples, startPx) {
  const traces = onset.traces;
  if (!traces) return;
  const keys = Object.keys(traces).filter((k) => traces[k]?.columns?.length);
  nodeGraphOnsetDrawStrip(canvas, onset, keys, slot, settings, height, width, faceSamples, startPx, 0, width);
}

function nodeGraphOnsetPaint(spec, live) {
  const canvas = spec.canvas;
  const settings = spec.settings;
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  const onset = canvas._onset || (canvas._onset = {
    origin: NaN,
    drawn: NaN,
    parked: false,
    live: false,
    below: true,
    resetHi: false,
    scanned: NaN,
    right: { below: true },
  });
  const absEnd = typeof nodeGraphScopeBufferAbsoluteFrame === "function"
    ? nodeGraphScopeBufferAbsoluteFrame(live)
    : 0;
  const retained = typeof nodeGraphScopeAvailableSampleCount === "function"
    ? nodeGraphScopeAvailableSampleCount(live)
    : (live.length || 0);
  const absStart = Math.max(0, absEnd - retained);
  const planck = nodeGraphWaterfallPlanck();
  const scanFrom = Number.isFinite(onset.scanned) ? Math.max(absStart, onset.scanned) : absStart;
  const id = String(spec?.slot?.nodeId || "");
  const resetBuf = id && nodeGraphModuleScopeState?.buffers
    ? nodeGraphModuleScopeState.buffers.get(`${id}:Reset`)
    : null;
  const node = typeof nodeGraphModuleScopeNodeForSlot === "function"
    ? nodeGraphModuleScopeNodeForSlot(spec.slot)
    : null;
  const hz = nodeGraphWaterfallVisualHz(live);
  const resetEdges = [];
  nodeGraphOnsetScanEdges(
    resetBuf,
    scanFrom,
    absEnd,
    planck,
    onset,
    "reset",
    (frame) => resetEdges.push(frame),
  );
  let signalHit = nodeGraphOnsetScanEdges(live, scanFrom, absEnd, planck, onset, "signal");
  const right = spec.stereoBuffers?.right;
  if (right && right !== live) {
    const rightHit = nodeGraphOnsetScanEdges(right, scanFrom, absEnd, planck, onset.right, "signal");
    if (rightHit >= 0 && (signalHit < 0 || rightHit > signalHit)) signalHit = rightHit;
  }
  onset.scanned = absEnd;
  // Pause at end off (default): the sweep runs continuously, wrapping at the
  // end of the window and overwriting the old trace. On: it holds at the end
  // until the next pass start.
  const pauseAtEnd = settings?.pauseAtEnd === true;
  // Pass starts this paint: every Reset edge, in sample order, even several
  // in one paint. Pause at end with Reset unplugged: a signal edge once the
  // pass is done. Continuous with no pass yet: start now.
  let starts = resetEdges;
  if (!starts.length && pauseAtEnd && !resetBuf) {
    starts = signalHit >= 0 && (onset.parked || !onset.live) ? [signalHit] : [];
  }
  if (!pauseAtEnd && !starts.length && !onset.live) starts = [scanFrom];
  let position = typeof nodeGraphModuleScopeNodeParam === "function"
    ? nodeGraphModuleScopeNodeParam(node, "position", 0)
    : 0;
  if (!Number.isFinite(position)) position = 0;
  position = Math.max(0, Math.min(1, position));
  const positionX = position >= 1 ? width - 1 : position * width;
  const present = () => {
    nodeGraphWaterfallPresentHold(spec.context, canvas, spec.bg);
    if (typeof nodeGraphOnsetGlPositionLine === "function") {
      nodeGraphOnsetGlPositionLine(canvas, positionX);
    }
    nodeGraphWaterfallFinishOutputInk(spec, spec.context, canvas, 0);
    if (typeof rememberNodeGraphTraceDisplaySignature === "function") {
      rememberNodeGraphTraceDisplaySignature(spec.slot, spec.item, live, settings);
    }
  };
  const autoRange = node?.type === "onset" && nodeGraphOnsetAutoRangeOn(settings);
  if (!autoRange) onset.range = null;
  // One fixed x scale: History seconds across the face, every pass. A
  // Reset-gap scale moves impulses whenever the gap changes.
  const faceSamples = Math.max(1, Math.round(hz * Math.max(nodeGraphWaterfallHistorySeconds(settings), 0)));
  const blendMode = nodeGraphWaterfallBlendMode(settings, { rgbGuns: Boolean(spec?.rgbBuffers) });
  const plateBg = blendMode === "multiply" ? "#ffffff" : (spec.bg || "#000000");
  const startPx = Math.floor(position * width) % width;
  if (typeof nodeGraphWaterfallGlEnsure === "function") {
    nodeGraphWaterfallGlEnsure(canvas, plateBg);
  }
  // Any look setting (Background, colours, Ink, Scale, Auto Range, Stroke,
  // Position...) repaints the face now: plate in the new colour, every stored
  // column redrawn. History is handled below (it changes the x scale).
  const look = `${JSON.stringify({ ...settings, historySeconds: 0, zoomSeconds: 0 })}|${plateBg}|${startPx}|${width}x${height}`;
  const lookChanged = typeof onset.look === "string" && onset.look !== look;
  onset.look = look;
  if (lookChanged) {
    if (autoRange) onset.range = nodeGraphOnsetTraceRange(onset);
    if (typeof nodeGraphWaterfallGlReset === "function") nodeGraphWaterfallGlReset(canvas, plateBg);
    nodeGraphOnsetRedrawTraces(canvas, onset, spec.slot, settings, height, width, faceSamples, startPx);
  }
  if (!starts.length && (!onset.live || !Number.isFinite(onset.origin))) {
    present();
    return true;
  }
  if (Number.isFinite(onset.latchedSamples) && onset.latchedSamples !== faceSamples && Number.isFinite(onset.origin)) {
    // History changed: the old ink is on another scale. Replay the current
    // pass from its start on a clean face.
    onset.drawn = onset.origin;
    onset.lastPixel = -1;
    onset.parked = false;
    onset.traces = Object.create(null);
    if (typeof nodeGraphWaterfallGlReset === "function") nodeGraphWaterfallGlReset(canvas, plateBg);
  }
  onset.latchedSamples = faceSamples;
  const channels = nodeGraphWaterfallChannelList({
    slot: spec.slot,
    settings,
    buffer: live,
    stereoBuffers: spec.stereoBuffers,
  }, settings).filter((ch) => ch.enabled !== false);
  const strokePx = typeof nodeGraphOnsetStrokeCanvasPx === "function"
    ? nodeGraphOnsetStrokeCanvasPx(canvas, settings)
    : 1;
  // Advance the write cursor of the current pass to `to` (exclusive). Columns
  // it reaches are cleared and take this pass's samples; columns ahead keep
  // the previous ink.
  const sweepTo = (to) => {
    const endDraw = Math.min(to, onset.origin + faceSamples);
    if (endDraw >= onset.origin + faceSamples) onset.parked = true;
    if (!(endDraw > onset.drawn)) return;
    const p1 = Math.max(0, Math.min(width, Math.floor(((endDraw - onset.origin) / faceSamples) * width)));
    for (let p = onset.lastPixel + 1; p < p1; p += 1) {
      if (typeof nodeGraphWaterfallGlClearColumn === "function") {
        nodeGraphWaterfallGlClearColumn(canvas, (startPx + p) % width, 1, plateBg);
      }
    }
    onset.lastPixel = Math.max(onset.lastPixel, p1 - 1);
    // Note every channel's new samples first, then redraw one open strip for
    // all of them in channel order: L, then R on top. The strip starts
    // `reach` columns before the first new one, so a thick line's spill into
    // its neighbours is redrawn, not cut.
    const keys = [];
    let beginAll = width;
    let endAll = -1;
    for (let i = 0; i < channels.length; i += 1) {
      const ch = channels[i];
      const key = ch.lastYKey || String(i);
      const rgb = [...nodeGraphWaterfallParseInkRgb(ch.color), nodeGraphWaterfallClamp01(ch.bright ?? 1, 1)];
      const trace = nodeGraphOnsetTraceEnsure(onset, key, rgb, ch.buffer, width);
      keys.push(key);
      for (let s = onset.drawn; s < endDraw; s += 1) {
        const v = typeof nodeGraphScopeBufferSampleAtAbsoluteFrame === "function"
          ? nodeGraphScopeBufferSampleAtAbsoluteFrame(ch.buffer, s)
          : null;
        if (v == null || !Number.isFinite(v)) continue;
        const c = nodeGraphOnsetTraceColumn(s, onset.origin, faceSamples, width);
        if (trace.columns[c]?.origin !== onset.origin) trace.columns[c] = { origin: onset.origin };
        nodeGraphOnsetColumnNote(trace.columns[c], s, v);
        if (c < beginAll) beginAll = c;
        if (c > endAll) endAll = c;
      }
    }
    onset.drawn = endDraw;
    // Auto Range: a new min or max moves every stored point, so replay the face.
    const range = autoRange ? nodeGraphOnsetTraceRange(onset) : null;
    const prevRange = onset.range;
    onset.range = range;
    if (range && (!prevRange || prevRange.lo !== range.lo || prevRange.hi !== range.hi)) {
      if (typeof nodeGraphWaterfallGlReset === "function") nodeGraphWaterfallGlReset(canvas, plateBg);
      nodeGraphOnsetRedrawTraces(canvas, onset, spec.slot, settings, height, width, faceSamples, startPx);
      return;
    }
    if (!(endAll >= beginAll)) return;
    const c0 = Math.max(0, beginAll - Math.ceil(strokePx * 0.5 + 1.5));
    // The open column can gain a new peak after it was drawn: it is cleared
    // and drawn again with the rest of the strip.
    if (typeof nodeGraphWaterfallGlClearColumn === "function") {
      for (let c = c0; c <= endAll; c += 1) {
        nodeGraphWaterfallGlClearColumn(canvas, (startPx + c) % width, 1, plateBg);
      }
    }
    // A strip across the right edge (x wraps to 0) draws in two parts, each
    // only over its own cleared columns: no ink lands twice.
    const edge = width - startPx;
    if (c0 < edge && endAll >= edge) {
      nodeGraphOnsetDrawStrip(
        canvas, onset, keys, spec.slot, settings, height, width, faceSamples, startPx,
        c0, edge, startPx + c0,
      );
      nodeGraphOnsetDrawStrip(
        canvas, onset, keys, spec.slot, settings, height, width, faceSamples, startPx,
        edge, endAll + 1,
      );
    } else {
      nodeGraphOnsetDrawStrip(
        canvas, onset, keys, spec.slot, settings, height, width, faceSamples, startPx,
        c0, endAll + 1, (startPx + c0) % width,
      );
    }
  };
  const restart = (at) => {
    onset.origin = at;
    onset.drawn = at;
    onset.parked = false;
    onset.live = true;
    onset.lastPixel = -1;
  };
  // A wrapped pass starts at Position on the next sample after the window. It
  // only starts when a whole window fits before the next Reset expected from
  // the last Reset gap; otherwise the sweep holds at the end so that Reset
  // (not a wrap at another phase) starts the next pass. Without Reset it
  // always wraps; a Reset overdue by a window (stopped or unplugged) no
  // longer holds it.
  const nextReset = () => (onset.resetGap > 0 && Number.isFinite(onset.lastReset)
    ? onset.lastReset + onset.resetGap
    : -Infinity);
  // `stop` is exclusive: the newest swept sample is stop - 1.
  const wrapFits = (at, stop) => stop - 1 > nextReset() + faceSamples
    || at >= nextReset() || at + faceSamples <= nextReset();
  // Sweep the current pass up to `stop`. Continuous: at the end of the window
  // the cursor wraps to x = Position and keeps overwriting.
  const sweepUntil = (stop) => {
    if (!onset.live || !Number.isFinite(onset.origin)) return;
    if (!pauseAtEnd) {
      while (onset.origin + faceSamples <= stop && wrapFits(onset.origin + faceSamples, stop)) {
        // Whole windows older than the last one would be overwritten anyway.
        const skip = Math.floor((stop - onset.origin) / faceSamples) - 1;
        if (skip > 0 && wrapFits(onset.origin + skip * faceSamples, stop)) {
          restart(onset.origin + skip * faceSamples);
          continue;
        }
        sweepTo(onset.origin + faceSamples);
        restart(onset.origin + faceSamples);
      }
    }
    sweepTo(stop);
  };
  // Reset edges in sample order: each one updates the expected next Reset
  // once the sweep reaches it.
  let edge = 0;
  const noteResets = (upTo) => {
    for (; edge < resetEdges.length && resetEdges[edge] <= upTo; edge += 1) {
      sweepUntil(resetEdges[edge]);
      if (Number.isFinite(onset.lastReset) && resetEdges[edge] > onset.lastReset) {
        onset.resetGap = resetEdges[edge] - onset.lastReset;
      }
      onset.lastReset = resetEdges[edge];
    }
  };
  // Each new start restarts the cursor at x = Position on that exact sample.
  // Nothing is cleared at a restart.
  for (let i = 0; i < starts.length; i += 1) {
    noteResets(starts[i] - 1);
    sweepUntil(starts[i]);
    restart(starts[i]);
    noteResets(starts[i]);
  }
  noteResets(absEnd);
  sweepUntil(absEnd);
  present();
  return true;
}

/** Planck amplitude. Same constant as nodeGraphPlanck / NODE_GRAPH_PLANCK. */
function nodeGraphWaterfallPlanck() {
  if (typeof nodeGraphPlanck === "function") {
    const n = Number(nodeGraphPlanck());
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const n = typeof NODE_GRAPH_PLANCK === "number" ? Number(NODE_GRAPH_PLANCK) : NaN;
  if (Number.isFinite(n) && n >= 0) return n;
  return 1e-7;
}

/** Display option. Off by default. History at 0 is one bar, not this pause. */
function nodeGraphWaterfallPauseOnSilence(settings) {
  return settings?.pauseOnSilence === true;
}

/**
 * Raw linear extent never leaves rest. Checked before dB mapping, so a real
 * negative-dB RMS reading is not silence. At or below Planck is no excursion.
 */
function nodeGraphWaterfallExtentIsSilent(minV, maxV) {
  const lo = Number(minV);
  const hi = Number(maxV);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return true;
  return Math.max(Math.abs(lo), Math.abs(hi)) <= nodeGraphWaterfallPlanck();
}

/** True when buf's newest count samples include a linear amp above Planck. */
function nodeGraphWaterfallTailIsLoud(buffer, count, planck) {
  const end = buffer?.length || 0;
  const n = Math.max(0, Math.floor(count));
  if (!end || !(n > 0)) return false;
  const start = Math.max(0, end - n);
  for (let s = start; s < end; s += 1) {
    const v = Number(buffer[s]);
    if (Number.isFinite(v) && Math.abs(v) > planck) return true;
  }
  return false;
}

/**
 * Undrawn window is silence on every enabled channel that actually has samples.
 * Empty, missing, or disabled channels are not silence: Output's unwired side,
 * a zero-length ring, or a channel that is not enabled must not latch the hold.
 * The face buffer is included so a loud mono or Wave Raw tail is not ignored
 * because another enabled channel is an empty or quiet ring.
 * Nothing new (count 0) is not silence, so a cursor that has not moved is not eaten.
 */
function nodeGraphWaterfallIncomingIsSilent(spec, settings, window, liveBuffer) {
  const planck = nodeGraphWaterfallPlanck();
  const count = Math.max(0, Math.floor(nodeGraphFiniteNumber(window?.count)));
  if (!(count > 0)) return false;
  const channels = nodeGraphWaterfallChannelList(spec, settings)
    .filter((ch) => ch.enabled !== false && ch.buffer && (ch.buffer.length || 0) > 0);
  const buffers = [];
  const seen = new Set();
  const push = (buf) => {
    if (!buf || !(buf.length > 0) || seen.has(buf)) return;
    seen.add(buf);
    buffers.push(buf);
  };
  for (let i = 0; i < channels.length; i += 1) push(channels[i].buffer);
  push(liveBuffer);
  push(spec?.buffer);
  if (!buffers.length) return false;
  let examined = false;
  for (let i = 0; i < buffers.length; i += 1) {
    const buf = nodeGraphWaterfallPrepare(buffers[i], settings) || buffers[i];
    if (nodeGraphWaterfallTailIsLoud(buf, count, planck)) return false;
    if ((buf?.length || 0) > 0) examined = true;
  }
  return examined;
}

/** Bipolar +/-1 reaches the face edges. No vertical inset. RMS dB guides use the same full span. */
function nodeGraphWaterfallHalfHeight(height, _slot, _settings, _amp) {
  return nodeGraphFiniteNumber(height, 0) * 0.5;
}

function nodeGraphWaterfallPolarity(settings) {
  const raw = String(settings?.polarity || "").trim().toLowerCase();
  if (raw === "unipolar" || raw === "uni" || raw === "unsigned") return "unipolar";
  if (raw === "absolute" || raw === "abs") return "absolute";
  if (raw === "bottomfill" || raw === "bottom") return "bottomFill";
  return "bipolar";
}

/** Bottom fill: bipolar -1..1 map, bars fill from the bottom edge to the peak. */
function nodeGraphWaterfallIsBottomFill(settings) {
  return nodeGraphWaterfallPolarity(settings) === "bottomFill";
}

/** Display Scale. 1 leaves the face unchanged. Not a module amplitude. */
function nodeGraphWaterfallDisplayScale(settings) {
  const n = Number(settings?.scale);
  if (!Number.isFinite(n) || !(n > 0)) return 1;
  if (n < 0.01) return 0.01;
  if (n > 100) return 100;
  return n;
}

function nodeGraphWaterfallY(raw, gain, offset, midY, halfHeight, amp = null, settings = null) {
  const ampScale = nodeGraphWaterfallDisplayScale(settings);
  let bipolar;
  if (amp && typeof amp === "object" && amp.mode === "rmsDb") {
    const useLut = amp.useLogLut !== false;
    const db = typeof nodeGraphRmsLinearToDb === "function"
      ? nodeGraphRmsLinearToDb(raw, useLut)
      : (Number(raw) > 0 ? 20 * Math.log10(Math.max(Number(raw), 1e-10)) : -120);
    bipolar = typeof nodeGraphRmsDbToFaceBipolar === "function"
      ? nodeGraphRmsDbToFaceBipolar(db, amp.minDb, amp.maxDb)
      : 0;
    bipolar *= ampScale;
  } else {
    // gain/offset are a unit map only (limiter 0..1 becomes +/-1). Scale once, after that.
    bipolar = ((Number.isFinite(Number(raw)) ? Number(raw) : 0)
      * (nodeGraphFiniteNumber(gain, 1))
      + (nodeGraphFiniteNumber(offset)))
      * ampScale;
  }
  const polarity = nodeGraphWaterfallPolarity(settings);
  if (polarity === "absolute" && !(amp && amp.mode === "rmsDb")) {
    bipolar = Math.abs(bipolar);
  }
  if ((polarity === "unipolar" || polarity === "absolute") && !(amp && amp.mode === "rmsDb")) {
    const u = Math.max(0, Math.min(1, bipolar));
    const h = Math.max(1, midY * 2);
    return h - u * h;
  }
  if (polarity === "bottomFill") {
    const h = Math.max(1, midY * 2);
    return Math.max(0, Math.min(h, midY - bipolar * halfHeight));
  }
  return midY - bipolar * halfHeight;
}

function nodeGraphWaterfallPrepare(buffer, settings) {
  if (typeof prepareNodeGraphTraceDisplayBuffer === "function") {
    return prepareNodeGraphTraceDisplayBuffer(buffer, settings) || buffer;
  }
  return buffer;
}

function nodeGraphWaterfallVisualHz(buffer) {
  if (typeof nodeGraphScopeSampleRate === "function") {
    const hz = nodeGraphScopeSampleRate(buffer);
    if (hz > 0) return hz;
  }
  const engine = Number(nodeGraphModuleScopeState?.sampleRate) || Number(nodeGraphMvp?.sampleRate);
  return engine > 0 ? engine : 44100;
}

function nodeGraphWaterfallAmp(buffer, slot) {
  // RMS meter face: dB-linear, Min dB → bottom, Max dB → top (defaults −48…0).
  const def = typeof nodeGraphModuleDefinitions === "object"
    ? nodeGraphModuleDefinitions[slot?.type]
    : null;
  if (def?.rmsDbGuides) {
    if (typeof nodeGraphRmsFaceRangeFromSlot === "function") {
      return nodeGraphRmsFaceRangeFromSlot(slot);
    }
    return {
      mode: "rmsDb",
      gain: 1,
      offset: 0,
      minDb: typeof NODE_GRAPH_RMS_DB_DEFAULT_MIN === "number" ? NODE_GRAPH_RMS_DB_DEFAULT_MIN : -48,
      maxDb: typeof NODE_GRAPH_RMS_DB_CEIL === "number" ? NODE_GRAPH_RMS_DB_CEIL : 0,
    };
  }
  // Trace buffer view folds Display Scale into gain. Waterfall applies Scale
  // once in nodeGraphWaterfallY, so this stays a unit map. Limiter Gain is
  // 0..1; Scale 1 puts that on +/-1 as 2*raw-1.
  if (slot?.type === "lookaheadLimiter" || slot?.type === "limiter") {
    return { gain: 2, offset: -1 };
  }
  // Sidechain Envelope is a duck amount 0..1. Reduction dips from the top
  // (APP_POLICY 3): 0 at the top, 1 at the bottom, as 1 - 2*raw.
  // Dry / Wet Gain face taps are gain / rest (1 = rest): middle = rest,
  // top = 2x rest (+6 dB), bottom = silent, as raw - 1.
  if (slot?.type === "sidechain") {
    const modeKey = typeof nodeGraphModuleSelectedDisplayMode === "function"
      ? nodeGraphModuleSelectedDisplayMode({ type: "sidechain" })?.key
      : "gains";
    if (modeKey === "gain") {
      return { gain: -2, offset: 1 };
    }
    return { gain: 1, offset: -1 };
  }
  return { gain: 1, offset: 0 };
}


function nodeGraphWaterfallAbsEnd(buffer) {
  if (typeof nodeGraphScopeBufferAbsoluteFrame === "function") {
    const n = nodeGraphScopeBufferAbsoluteFrame(buffer);
    if (n > 0) return n;
  }
  const abs = Number(buffer?.nodeGraphScopeAbsoluteFrame);
  if (Number.isFinite(abs) && abs > 0) return abs;
  const total = Number(buffer?.nodeGraphScopeTotalSampleCount);
  return Number.isFinite(total) && total > 0 ? total : Number.NaN;
}

/**
 * Map a sample window on the clock ring onto another channel.
 * Newest samples sit at the end of every ring. Use the same age from newest
 * (fractional indexes kept) so Right/B gets one value per pixel the same way
 * Left does. Absolute-frame mapping only matches when both rings started on
 * the same clock; a miss pinned every column to that ring's tail, so Right
 * drew one hold per frame while Left lerped across the window.
 */
function nodeGraphWaterfallMapSampleWindow(live, buffer, start, end) {
  if (!buffer?.length) return null;
  if (!live?.length || buffer === live) return { start, end };
  const liveStart = Number(start);
  const liveEnd = Number(end);
  if (!Number.isFinite(liveStart) || !Number.isFinite(liveEnd)) return null;
  const liveLen = live.length;
  const bufLen = buffer.length;
  return {
    start: bufLen - (liveLen - liveStart),
    end: bufLen - (liveLen - liveEnd),
  };
}

/** Clock ring: the enabled channel whose absolute frame is furthest ahead.
 *  Ties keep the earlier candidate (left / R / X), so a matched stereo pair
 *  still scrolls from the left ring.
 */
function nodeGraphWaterfallLiveBuffer(spec, settings) {
  const prep = (buf) => (buf && (nodeGraphWaterfallPrepare(buf, settings) || buf)) || null;
  const candidates = [];
  if (spec?.rgbBuffers) {
    candidates.push(spec.rgbBuffers.R, spec.rgbBuffers.G, spec.rgbBuffers.B, spec.buffer);
  } else if (spec?.xyzBuffers) {
    candidates.push(spec.xyzBuffers.X, spec.xyzBuffers.Y, spec.xyzBuffers.Z, spec.buffer);
  } else if (spec?.stereoBuffers) {
    candidates.push(spec.stereoBuffers.left, spec.stereoBuffers.right, spec.buffer);
  } else {
    candidates.push(spec?.buffer);
  }
  let best = null;
  let bestAbs = -1;
  for (let i = 0; i < candidates.length; i += 1) {
    const buf = prep(candidates[i]);
    if (!buf?.length) continue;
    const abs = nodeGraphWaterfallAbsEnd(buf);
    const score = Number.isFinite(abs) && abs > 0 ? abs : 0;
    if (!best || score > bestAbs) {
      best = buf;
      bestAbs = score;
    }
  }
  return best;
}

/** R+B=G meet. Same complement as TraceStroke (red+blue → green). */
function nodeGraphWaterfallMeetRgb(leftRgb, rightRgb) {
  const l = leftRgb || [255, 0, 0];
  const r = rightRgb || [0, 0, 255];
  let m = null;
  if (typeof TraceStroke !== "undefined" && typeof TraceStroke.meetColorFromPair === "function") {
    m = TraceStroke.meetColorFromPair(l, r);
  }
  if (!m || m.length < 3) {
    m = [
      Math.max(0, 1 - l[0] / 255 - r[0] / 255),
      Math.max(0, 1 - l[1] / 255 - r[1] / 255),
      Math.max(0, 1 - l[2] / 255 - r[2] / 255),
    ];
  }
  return [
    Math.round(Math.max(0, Math.min(1, Number(m[0]))) * 255),
    Math.round(Math.max(0, Math.min(1, Number(m[1]))) * 255),
    Math.round(Math.max(0, Math.min(1, Number(m[2]))) * 255),
  ];
}

function nodeGraphWaterfallYsInterval(ys) {
  if (!ys) return null;
  const y0 = Math.min(ys.y0, ys.y1);
  const y1 = Math.max(ys.y0, ys.y1);
  if (!Number.isFinite(y0) || !Number.isFinite(y1)) return null;
  return { y0, y1 };
}

/** Exclusive right/B spans plus the overlap that paints the meet color. */
function nodeGraphWaterfallRightOnlySpans(leftYs, rightYs) {
  const b = nodeGraphWaterfallYsInterval(rightYs);
  if (!b) return { only: [], overlap: null };
  const a = nodeGraphWaterfallYsInterval(leftYs);
  if (!a) return { only: [b], overlap: null };
  const o0 = Math.max(a.y0, b.y0);
  const o1 = Math.min(a.y1, b.y1);
  if (!(o1 > o0)) return { only: [b], overlap: null };
  const only = [];
  if (b.y0 < o0) only.push({ y0: b.y0, y1: o0 });
  if (b.y1 > o1) only.push({ y0: o1, y1: b.y1 });
  return { only, overlap: { y0: o0, y1: o1 } };
}

function nodeGraphWaterfallStampFilledSpan(canvas, x, ys, prevEdge, connect, rgb, blend) {
  if (!ys || typeof nodeGraphWaterfallGlStampBar !== "function") return;
  nodeGraphWaterfallGlStampBar(
    canvas,
    x,
    1,
    ys,
    connect ? prevEdge : null,
    Boolean(connect && prevEdge),
    rgb,
    blend,
    1,
    true,
    null,
  );
}

/**
 * Two-channel combine/meet (the Blend control R+B=G): left source-over,
 * exclusive B in the right color, overlap in the meet color.
 * Any other blend, or more than two channels, keeps the existing layer composite.
 */
function nodeGraphWaterfallStampColumnFills(canvas, x, spans, mode, stampComposite, filled) {
  if (!filled || typeof nodeGraphWaterfallGlStampBar !== "function") return;
  const meet = (mode === "combine" || mode === "meet") && spans.length === 2;
  if (!meet) {
    for (let i = 0; i < spans.length; i += 1) {
      const span = spans[i];
      if (!span.ys) continue;
      const layer = (i === 0 && stampComposite !== "multiply") ? "source-over" : stampComposite;
      nodeGraphWaterfallStampFilledSpan(canvas, x, span.ys, span.prevEdge, true, span.rgb, layer);
    }
    return;
  }
  // Meet is additive, where alpha and a scaled colour are the same thing:
  // premultiply Brightness into the colours the Meet shader mixes.
  const premul = (span) => (span && Array.isArray(span.rgb) && span.rgb.length > 3
    ? { ...span, rgb: nodeGraphWaterfallScaleRgb(span.rgb.slice(0, 3), span.rgb[3]) }
    : span);
  const left = premul(spans[0]);
  const right = premul(spans[1]);
  // Both channels: one GPU draw, the meet colour picked per pixel by the
  // shared Meet GLSL (trace-meet-glsl.js). The stamps below stay as the
  // path when that shader is missing.
  if (left.ys && right.ys && typeof nodeGraphWaterfallGlStampMeetColumn === "function") {
    const meetParts = nodeGraphWaterfallRightOnlySpans(left.ys, right.ys);
    if (nodeGraphWaterfallGlStampMeetColumn(
      canvas,
      x,
      left.ys,
      left.prevEdge,
      meetParts,
      left.rgb,
      right.rgb,
      nodeGraphWaterfallMeetRgb(left.rgb, right.rgb),
    )) {
      return;
    }
  }
  if (left.ys) {
    nodeGraphWaterfallStampFilledSpan(canvas, x, left.ys, left.prevEdge, true, left.rgb, "source-over");
  }
  if (!right.ys) return;
  if (!left.ys) {
    nodeGraphWaterfallStampFilledSpan(canvas, x, right.ys, right.prevEdge, true, right.rgb, "source-over");
    return;
  }
  const parts = nodeGraphWaterfallRightOnlySpans(left.ys, right.ys);
  for (let p = 0; p < parts.only.length; p += 1) {
    nodeGraphWaterfallStampFilledSpan(canvas, x, parts.only[p], null, false, right.rgb, "source-over");
  }
  if (parts.overlap) {
    nodeGraphWaterfallStampFilledSpan(
      canvas,
      x,
      parts.overlap,
      null,
      false,
      nodeGraphWaterfallMeetRgb(left.rgb, right.rgb),
      "source-over",
    );
  }
}

function nodeGraphWaterfallUndrawn(buffer, lastAbs) {
  const end = buffer?.length || 0;
  if (!end) return { count: 0, absEnd: Number.NaN, start: 0, end: 0 };
  const absEnd = nodeGraphWaterfallAbsEnd(buffer);
  const recent = Math.max(0, Math.floor(nodeGraphFiniteNumber(buffer.nodeGraphScopeRecentSampleCount)));
  const recentN = recent > 0 ? Math.min(end, recent) : Math.min(end, 1);
  if (Number.isFinite(absEnd) && absEnd > 0 && Number.isFinite(lastAbs) && lastAbs > 0) {
    // Cursor ahead of this ring (pause/stop rewind, or a new session).
    // count 0 here left the plate looking paused after Play even though samples exist.
    if (lastAbs > absEnd) {
      return { count: recentN, absEnd, start: Math.max(0, end - recentN), end };
    }
    if (lastAbs >= absEnd) return { count: 0, absEnd, start: end, end };
    const undrawn = Math.min(end, Math.max(0, Math.floor(absEnd - lastAbs)));
    return { count: undrawn, absEnd, start: Math.max(0, end - undrawn), end };
  }
  return { count: recentN, absEnd, start: Math.max(0, end - recentN), end };
}

/** Fresh peak-to-peak accumulator (raw sample units). */
function nodeGraphWaterfallAccMake() {
  // minAt / maxAt / last: time order for the Stroke waveform (both peaks).
  return { min: Infinity, max: -Infinity, has: false, minAt: 0, maxAt: 0, last: Number.NaN };
}

/** Fold samples into a running min/max. Does not scan beyond [start, end). */
function nodeGraphWaterfallAccPush(acc, buffer, start, end, settings = null, slot = null) {
  if (!acc || !buffer?.length) {
    return acc;
  }
  const from = Math.max(0, Math.floor(start));
  const to = Math.min(buffer.length, Math.max(from, Math.floor(end)));
  if (to <= from) {
    // Narrower than one sample: floor(start)..floor(end) is empty, so the
    // column used to be skipped and a slow sine at detail 1 drew nothing.
    // The column value is the sample at this window's right edge.
    const right = Number(end);
    if (right > Number(start) && Number.isFinite(right)) {
      const v = nodeGraphWaterfallLerpSample(buffer, right);
      if (Number.isFinite(v)) {
        if (!acc.has) {
          acc.min = v;
          acc.max = v;
          acc.has = true;
          acc.minAt = right;
          acc.maxAt = right;
        } else {
          if (v < acc.min) { acc.min = v; acc.minAt = right; }
          if (v > acc.max) { acc.max = v; acc.maxAt = right; }
        }
        acc.last = v;
      }
    }
    return acc;
  }
  // Fixed peak-tip inspect budget (Detail control removed).
  const maxInspect = 8192;
  const spanN = to - from;
  const step = spanN > maxInspect ? Math.ceil(spanN / maxInspect) : 1;
  for (let i = from; i < to; i += step) {
    const v = Number(buffer[i]);
    if (!Number.isFinite(v)) {
      continue;
    }
    if (!acc.has) {
      acc.min = v;
      acc.max = v;
      acc.has = true;
      acc.minAt = i;
      acc.maxAt = i;
    } else {
      if (v < acc.min) {
        acc.min = v;
        acc.minAt = i;
      }
      if (v > acc.max) {
        acc.max = v;
        acc.maxAt = i;
      }
    }
    acc.last = v;
  }
  // Always include the true last sample so the bar tip tracks the newest value.
  if (step > 1 && to > from) {
    const last = Number(buffer[to - 1]);
    if (Number.isFinite(last)) {
      if (!acc.has) {
        acc.min = last;
        acc.max = last;
        acc.has = true;
        acc.minAt = to - 1;
        acc.maxAt = to - 1;
      } else {
        if (last < acc.min) {
          acc.min = last;
          acc.minAt = to - 1;
        }
        if (last > acc.max) {
          acc.max = last;
          acc.maxAt = to - 1;
        }
      }
      acc.last = last;
    }
  }
  return acc;
}

function nodeGraphWaterfallAccReset(acc) {
  if (!acc) {
    return nodeGraphWaterfallAccMake();
  }
  acc.min = Infinity;
  acc.max = -Infinity;
  acc.has = false;
  acc.minAt = 0;
  acc.maxAt = 0;
  acc.last = Number.NaN;
  return acc;
}

/**
 * Stroke = draw the waveform. Raw samples of one column in time order:
 * the two peaks (whichever came first first) then the column's last sample.
 * Absolute polarity folds a sign change through 0 between the peaks.
 * Both peaks are kept, so the line covers the top AND bottom of the signal.
 */
function nodeGraphWaterfallWaveRaw(acc, settings = null) {
  if (!acc?.has) return [];
  const minFirst = !(Number(acc.maxAt) < Number(acc.minAt));
  const a = minFirst ? acc.min : acc.max;
  const b = minFirst ? acc.max : acc.min;
  const out = [a];
  if (nodeGraphWaterfallPolarity(settings) === "absolute" && acc.min < 0 && acc.max > 0) out.push(0);
  out.push(b);
  const last = Number(acc.last);
  if (Number.isFinite(last)) out.push(last);
  return out;
}

/** Face Y (canvas px) for nodeGraphWaterfallWaveRaw, same mapping as the bars. */
function nodeGraphWaterfallWaveYs(acc, buffer, slot, settings, height) {
  const raw = nodeGraphWaterfallWaveRaw(acc, settings);
  if (!raw.length) return [];
  const live = nodeGraphWaterfallPrepare(buffer, settings) || buffer;
  const amp = nodeGraphWaterfallAmp(live, slot);
  const midY = height * 0.5;
  const halfHeight = nodeGraphWaterfallHalfHeight(height, slot, settings, amp);
  const ys = [];
  for (let i = 0; i < raw.length; i += 1) {
    const y = nodeGraphWaterfallY(raw[i], amp.gain, amp.offset, midY, halfHeight, amp, settings);
    if (Number.isFinite(y) && (!ys.length || Math.abs(ys[ys.length - 1] - y) > 1e-6)) ys.push(y);
  }
  return ys;
}

/** Stroke width in history pixels and how far a stroke reaches past a point. */
function nodeGraphWaterfallStrokeReach(canvas, settings) {
  const strokePx = typeof nodeGraphOnsetStrokeCanvasPx === "function"
    ? nodeGraphOnsetStrokeCanvasPx(canvas, settings)
    : nodeGraphWaterfallStrokePx(settings);
  // Half the width plus the 1px AA ramp, rounded up to whole columns.
  return { strokePx, reach: Math.ceil(strokePx * 0.5 + 1.5) };
}

/**
 * Stroke one channel's new columns as the waveform, once per frame: a
 * polyline through each column's peaks (time order, spread across the
 * column) from the previous frame's tail. bag.strokePts[key] keeps the tail
 * (the points whose line can still reach the open strip).
 * clipX0: the strip that was cleared and is being redrawn; the line is drawn
 * only there, so finished history is never inked twice. cols: [{ x, ys }]
 * in x order (ys null = no signal, which breaks the line).
 */
function nodeGraphWaterfallStrokeWaveRun(canvas, bag, key, cols, settings, strokeColor, clipX0) {
  if (!bag.strokePts) bag.strokePts = Object.create(null);
  const { strokePx, reach } = nodeGraphWaterfallStrokeReach(canvas, settings);
  // Clamp to the panel so values past the top / bottom (Sidechain gain > 2x
  // rest) ride the edge, fully visible, instead of leaving the canvas.
  const faceH = Number(canvas?.height);
  const inset = faceH > 0 ? Math.min(faceH * 0.5, Math.max(0, strokePx) * 0.5) : 0;
  const clampY = (y) => (faceH > 0 ? Math.max(inset, Math.min(faceH - inset, y)) : y);
  const rgb = nodeGraphWaterfallStrokeRgb(settings, strokeColor);
  const draw = (pts) => {
    if (pts.length > 1 && typeof nodeGraphOnsetGlStrokePolyline === "function") {
      nodeGraphOnsetGlStrokePolyline(canvas, pts, strokePx, rgb, clipX0);
    }
  };
  const kept = Array.isArray(bag.strokePts[key]) ? bag.strokePts[key] : [];
  let run = kept.slice();
  for (let c = 0; c < cols.length; c += 1) {
    const { x, ys } = cols[c];
    if (!ys || !ys.length) {
      draw(run);
      run = [];
      continue;
    }
    // Spread the column's peaks over its width (x .. x+1) instead of
    // stacking them on one x (a vertical spike, a stair at every pixel).
    // The last sample sits on the right edge, where the next column starts.
    const n = ys.length;
    if (!run.length) run.push({ x, y: clampY(ys[0]) });
    for (let i = 0; i < n; i += 1) run.push({ x: x + (i + 1) / n, y: clampY(ys[i]) });
  }
  draw(run);
  if (!run.length) {
    delete bag.strokePts[key];
    return;
  }
  // Tail for the next frame: next frame redraws from (its strip - reach), so
  // keep every point whose line can reach that far, plus the one before.
  const last = run[run.length - 1];
  let first = 0;
  while (first < run.length - 1 && run[first + 1].x < last.x - 2 * reach - 2) first += 1;
  bag.strokePts[key] = run.slice(first);
}

/**
 * Sample-unit column extents for a filled bar.
 * One-sided columns expand to rest (0) so Output does not collapse to a 1px speck.
 * Vibrato peaks that already span both sides stay raw min..max.
 * RMS dB faces keep their own scale (linear 0 is not the meter floor).
 * @returns {{ min:number, max:number }}
 */
function nodeGraphWaterfallExcursionBar(minV, maxV, amp) {
  let min = Number(minV);
  let max = Number(maxV);
  if (!(amp && amp.mode === "rmsDb")) {
    if (min > 0) min = 0;
    if (max < 0) max = 0;
  }
  return { min, max };
}


/**
 * Linear sample at a fractional buffer index.
 * Used when detail 1 maps one sample across several columns.
 */
function nodeGraphWaterfallLerpSample(buffer, index) {
  const n = buffer?.length || 0;
  if (!(n > 0) || !Number.isFinite(index)) return NaN;
  if (!(index > 0)) return Number(buffer[0]);
  if (index >= n - 1) return Number(buffer[n - 1]);
  const i0 = Math.floor(index);
  const i1 = i0 + 1;
  const a = Number(buffer[i0]);
  const b = Number(buffer[i1]);
  const frac = index - i0;
  if (!Number.isFinite(a)) return Number.isFinite(b) ? b : NaN;
  if (!Number.isFinite(b)) return a;
  return a + (b - a) * frac;
}

function nodeGraphWaterfallSizePx(face, size01) {
  if (typeof TraceStroke !== "undefined" && typeof TraceStroke.diameterPx === "function") {
    return Math.max(0, TraceStroke.diameterPx(face, size01));
  }
  if (typeof faceInkPx === "function" && typeof clampAuthoredInkPx === "function") {
    return Math.max(0, faceInkPx(clampAuthoredInkPx(size01, 0), face));
  }
  return Math.max(0, nodeGraphFiniteNumber(size01, 0));
}

function nodeGraphWaterfallGlRadius(faceMin, size01) {
  return Math.max(0.5, nodeGraphWaterfallSizePx(faceMin, size01) * 0.5);
}

function nodeGraphWaterfallLutRgb(hex, fallback) {
  const fb = fallback || [255, 51, 51];
  if (typeof nodeGraphScopeHexColorToRgb === "function") {
    const rgb = nodeGraphScopeHexColorToRgb(hex);
    if (Array.isArray(rgb) && rgb.length >= 3) {
      if (rgb[0] > 1.01 || rgb[1] > 1.01 || rgb[2] > 1.01) return [rgb[0], rgb[1], rgb[2]];
      return [Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255)];
    }
  }
  const text = String(hex || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) {
    return [parseInt(text.slice(1, 3), 16), parseInt(text.slice(3, 5), 16), parseInt(text.slice(5, 7), 16)];
  }
  return fb.slice();
}

function nodeGraphWaterfallParseInkRgb(color) {
  if (Array.isArray(color) && color.length >= 3) {
    return [
      Math.max(0, Math.min(255, Math.round(nodeGraphFiniteNumber(color[0])))),
      Math.max(0, Math.min(255, Math.round(nodeGraphFiniteNumber(color[1])))),
      Math.max(0, Math.min(255, Math.round(nodeGraphFiniteNumber(color[2])))),
    ];
  }
  const m = String(color || "").trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (m) {
    return [
      Math.max(0, Math.min(255, Math.round(Number(m[1])))),
      Math.max(0, Math.min(255, Math.round(Number(m[2])))),
      Math.max(0, Math.min(255, Math.round(Number(m[3])))),
    ];
  }
  return nodeGraphWaterfallLutRgb(color);
}

function nodeGraphWaterfallClamp01(n, fallback = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function nodeGraphWaterfallScaleRgb(rgb, bright01) {
  const b = nodeGraphWaterfallClamp01(bright01, 1);
  if (b >= 0.999) return rgb;
  return [
    Math.max(0, Math.min(255, Math.round(rgb[0] * b))),
    Math.max(0, Math.min(255, Math.round(rgb[1] * b))),
    Math.max(0, Math.min(255, Math.round(rgb[2] * b))),
  ];
}

/** Preview pad = Size radius (blur does not grow the disc). */
function nodeGraphWaterfallSoftPad(radius, _blur01) {
  return Math.max(0.5, nodeGraphFiniteNumber(radius, 0.5));
}

/**
 * Radial alpha: blur 0 = hard disc at R; blur 1 = smoothstep center → edge at R.
 * Same profile as TraceTape (Size-normalized, no skirt growth).
 */
function nodeGraphWaterfallBlurAlpha(dist, radius, blur01) {
  const r = Math.max(0.5, nodeGraphFiniteNumber(radius, 0.5));
  const soft = nodeGraphWaterfallClamp01(blur01, 0);
  const t = Math.max(0, nodeGraphFiniteNumber(dist)) / r;
  if (soft < 0.02) {
    return t < 0.999 ? 1 : 0;
  }
  const knee = (1 - soft) * (1 - soft) * 0.92;
  if (t <= knee) return 1;
  if (t >= 1) return 0;
  const u = (t - knee) / Math.max(1e-6, 1 - knee);
  const s = u * u * (3 - 2 * u);
  return 1 - s;
}

/**
 * Preview dab on a GL line batch: size-normalized radial smoothstep (matches
 * nodeGraphWaterfallBlurAlpha / TraceTape). Hard when blur < 0.02.
 */
function nodeGraphWaterfallDab(batch, x, y, radius, rgb, blur01 = 0, alpha01 = 1) {
  if (!batch || typeof nodeGraphGlLinesDot !== "function") return;
  const r = Math.max(0.5, nodeGraphFiniteNumber(radius, 0.5));
  const blur = nodeGraphWaterfallClamp01(blur01, 0);
  const aMul = nodeGraphWaterfallClamp01(alpha01, 1);
  if (aMul <= 0.001) return;
  const knee = blur < 0.02 ? 1 : (1 - blur) * (1 - blur) * 0.92;
  const half = Math.max(0, r * knee - (blur < 0.02 ? 0.5 : 0));
  const feather = Math.max(blur < 0.02 ? 1 : 1e-3, r - half);
  nodeGraphGlLinesDot(batch, x, y, half, feather, [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, aMul]);
}

function nodeGraphWaterfallChannelList(spec, settings) {
  const size = settings.dot1Size ?? 2;
  const enabled = settings.dot1Enabled !== false;
  const color = settings.color || settings.dot1Color || "#ff3333";
  const blur = nodeGraphWaterfallClamp01(settings.blur ?? settings.lineThickness, 0);
  const bright = nodeGraphWaterfallClamp01(settings.dot1Brightness ?? settings.brightness, 1);
  const secondaryBright = nodeGraphWaterfallClamp01(
    settings.secondaryBrightness ?? settings.dot1Brightness ?? settings.brightness,
    bright,
  );
  if (spec?.rgbBuffers) {
    // CMY = subtractive guns (multiply → black). RGB = additive (lighter → white).
    const cmy = settings.cmyMode === true;
    return [
      {
        buffer: spec.rgbBuffers.R,
        color: cmy ? "#00ffff" : "#ff0000",
        size,
        enabled,
        blur,
        bright,
        lastYKey: "_waterfallLastRY",
      },
      {
        buffer: spec.rgbBuffers.G,
        color: cmy ? "#ff00ff" : "#00ff00",
        size,
        enabled,
        blur,
        bright,
        lastYKey: "_waterfallLastGY",
      },
      {
        buffer: spec.rgbBuffers.B,
        color: cmy ? "#ffff00" : "#0000ff",
        size,
        enabled,
        blur,
        bright,
        lastYKey: "_waterfallLastBY",
      },
    ];
  }
  if (spec?.xyzBuffers) {
    const colors = {
      X: settings.dot1Color || settings.color || "#ff0000",
      Y: settings.secondaryColor || "#0000ff",
      Z: settings.tertiaryColor || "#00ff00",
    };
    return ["X", "Y", "Z"].map((port) => ({
      buffer: spec.xyzBuffers[port],
      color: colors[port],
      size,
      enabled,
      blur,
      bright,
      lastYKey: "_waterfallLast" + port + "Y",
    }));
  }
  if (spec?.stereoBuffers) {
    return [
      {
        buffer: spec.stereoBuffers.left,
        color,
        size,
        enabled,
        blur,
        bright,
        lastYKey: "_waterfallLastLeftY",
        strokeColor: settings.strokeLeftColor || settings.strokeColor,
      },
      {
        buffer: spec.stereoBuffers.right,
        color: settings.secondaryColor || "#0000ff",
        size: settings.secondarySize ?? size,
        enabled: settings.secondaryEnabled !== false,
        blur,
        bright: secondaryBright,
        lastYKey: "_waterfallLastRightY",
        strokeColor: settings.strokeRightColor || settings.strokeColor,
      },
    ];
  }
  return [{
    buffer: spec?.buffer,
    color,
    size,
    enabled,
    blur,
    bright,
    lastYKey: "_waterfallLastY",
  }];
}

function nodeGraphWaterfallBlendMode(settings, options = {}) {
  if (options?.rgbGuns) {
    // CMY checkbox → multiply (darken to black). Else additive lighter → white.
    return settings?.cmyMode === true ? "multiply" : "lighter";
  }
  if (typeof nodeGraphScopeStereoBlendMode === "function") {
    return nodeGraphScopeStereoBlendMode(settings?.stereoBlend);
  }
  return String(settings?.stereoBlend || "combine");
}

function nodeGraphWaterfallHasTraceTape() {
  return typeof TraceTape !== "undefined"
    && typeof TraceTape.ensure === "function"
    && typeof TraceTape.stamp === "function"
    && typeof TraceTape.scroll === "function"
    && typeof TraceTape.presentTo === "function";
}

function nodeGraphWaterfallClearTapes(host) {
  if (!host || !nodeGraphWaterfallHasTraceTape()) return;
  for (let i = 0; i < 3; i += 1) {
    const tape = host["_traceTape" + i];
    if (tape) TraceTape.clear(tape);
  }
}

/**
 * Persistent 2D plate that scrolls with the waterfall. New columns on the
 * right are filled with the *current* background so bg color changes travel
 * left with the ink (old canvas drawImage hold path).
 */
/** History plate: the GPU ping-pong session (resize keeps history). No 2D hold. */
function nodeGraphWaterfallEnsureHold(canvas, width, height, bg) {
  if (!canvas) return null;
  const s = typeof nodeGraphWaterfallGlEnsure === "function"
    ? nodeGraphWaterfallGlEnsure(canvas, bg || "#000000")
    : null;
  if (!s) {
    nodeGraphDisplayGlFailed(canvas, "Waterfall GL unavailable");
    return null;
  }
  return s;
}

function nodeGraphWaterfallResetHold(canvas, bg) {
  if (typeof nodeGraphWaterfallGlReset === "function") {
    nodeGraphWaterfallGlReset(canvas, bg);
  }
}

function nodeGraphWaterfallScrollHold(canvas, scrollPx, bg) {
  const n = Math.max(0, nodeGraphFiniteNumber(scrollPx));
  if (!canvas || !(n > 1e-4)) return;
  nodeGraphWaterfallGlScroll(canvas, n, bg || "#000000");
}

/** Blit scrolled hold (bg + baked filled bars) to the face. */
/** Present the GPU history plate on the face. GL only. */
function nodeGraphWaterfallPresentHold(destCtx, destCanvas, bg) {
  if (!destCanvas) return;
  if (typeof nodeGraphWaterfallGlPresent === "function"
    && nodeGraphWaterfallGlPresent(destCanvas, bg)) {
    return;
  }
  nodeGraphDisplayGlFailed(destCanvas, "Waterfall GL present failed");
}

function nodeGraphWaterfallBarThickness(settings) {
  const n = Number(settings?.barThickness);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

/** Stamp solid filled peak-to-peak columns. No polyline, no Blur, no Stretch.
 * Detail 1 (edgeOpts.connect): each column is a trapezoid from the previous
 * column's edge to this column's edge, so a slow sine is a continuous fill.
 * Below detail 1, or when bar thickness opens a gutter, columns stay flat rects.
 */
function nodeGraphWaterfallBarInk(settings) {
  const raw = String(settings?.barInk || settings?.ink || "").toLowerCase();
  if (raw === "stroke" || raw === "both" || raw === "fill") return raw;
  return "fill";
}

function nodeGraphWaterfallBarsFilled(settings) {
  const ink = nodeGraphWaterfallBarInk(settings);
  return ink === "fill" || ink === "both";
}

function nodeGraphWaterfallDrawStroke(settings) {
  const ink = nodeGraphWaterfallBarInk(settings);
  return ink === "stroke" || ink === "both";
}

function nodeGraphWaterfallStrokePx(settings) {
  const n = Number(settings?.strokeThickness);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.25, Math.min(16, n));
}

// Stroke thickness is in screen pixels. Canvas backing and workspace zoom
// change how many texture pixels that is.
function nodeGraphOnsetStrokeCanvasPx(canvas, settings) {
  const screenPx = nodeGraphWaterfallStrokePx(settings);
  const scale = typeof nodeGraphModuleFacePixelScale === "function"
    ? nodeGraphModuleFacePixelScale(canvas)
    : 1;
  return Math.max(0.5, screenPx * scale);
}

// Per-channel stroke (two-channel faces) wins over the shared strokeColor.
function nodeGraphWaterfallStrokeRgb(settings, channelColor = null) {
  return nodeGraphWaterfallParseInkRgb(channelColor || settings?.strokeColor || "#ffffff");
}

function nodeGraphWaterfallAbandonTape(canvas) {
  if (!canvas) return;
  if (canvas._waterfall) {
    canvas._waterfall.barAcc = Object.create(null);
  }
  canvas._waterfall = null;
  canvas._traceScroll = null;
  canvas._waterfallHold = null;
  delete canvas._waterfallLastY;
  delete canvas._waterfallLastLeftY;
  delete canvas._waterfallLastRightY;
  delete canvas._waterfallLastXY;
  delete canvas._waterfallLastYY;
  delete canvas._waterfallLastZY;
  delete canvas._waterfallLastRY;
  delete canvas._waterfallLastGY;
  delete canvas._waterfallLastBY;
  for (let i = 0; i < 3; i += 1) {
    const tape = canvas["_traceTape" + i];
    if (tape && typeof TraceTape !== "undefined" && TraceTape.clear) {
      TraceTape.clear(tape);
    }
    delete canvas["_traceTape" + i];
  }
}

/**
 * Transport Stop: drop this face's whole waterfall history. Every variant
 * (mono / stereo / XYZ / RGB / onset) keeps its history on the face canvas:
 * tape cursor + hold plate + TraceTape strips + onset pass + WebGL history
 * textures. The next paint starts a fresh tape on an empty plate.
 */
function nodeGraphWaterfallWipeHistory(canvas) {
  if (!canvas) return false;
  if (!canvas._waterfall && !canvas._waterfallHold && !canvas._wfGlSession && !canvas._onset) {
    return false;
  }
  nodeGraphWaterfallAbandonTape(canvas);
  canvas._onset = null;
  canvas._wfSubPx = 0;
  if (typeof nodeGraphWaterfallGlWipe === "function") {
    nodeGraphWaterfallGlWipe(canvas);
  }
  return true;
}

function nodeGraphWaterfallState(canvas, width, height, nowLine, bg, context, blendMode) {
  const st = canvas._waterfall || (canvas._waterfall = {
    started: false,
    lastMs: Number.NaN,
    frac: 0,
    lastAbs: Number.NaN,
    nowLine: false,
    blend: "",
    lastW: 0,
    lastH: 0,
    barAcc: Object.create(null),
    edge: Object.create(null),
  });
  if (!st.barAcc) {
    st.barAcc = Object.create(null);
  }
  canvas._traceScroll = st;
  const blend = String(blendMode || "");
  const resized = Math.abs((st.lastW || 0) - width) > 2 || Math.abs((st.lastH || 0) - height) > 2;
  const nowLineChanged = st.nowLine !== nowLine;
  // B-110: blend change is not a cold start. New columns pick up the new
  // mode; existing plate/tape/hold stay. Do not wipe or replay history.
  if (!st.started || nowLineChanged) {
    if (typeof nodeGraphFacePlateFillCanvas === "function") {
      nodeGraphFacePlateFillCanvas(context, canvas, bg);
    }
    st.started = true;
    st.lastMs = nodeGraphWaterfallNowMs();
    st.frac = 0;
    st.colPx = 0;
    st.pxCarry = 0;
    st.lastAbs = Number.NaN;
    st.lastW = width;
    st.lastH = height;
    st.nowLine = nowLine;
    st.blend = blend;
    st.barAcc = Object.create(null);
    st.edge = Object.create(null);
    delete canvas._waterfallLastY;
    delete canvas._waterfallLastLeftY;
    delete canvas._waterfallLastRightY;
    delete canvas._waterfallLastXY;
    delete canvas._waterfallLastYY;
    delete canvas._waterfallLastZY;
    delete canvas._waterfallLastRY;
    delete canvas._waterfallLastGY;
    delete canvas._waterfallLastBY;
    nodeGraphWaterfallClearTapes(canvas);
    // Fresh mode → fresh scrolled bg plate (filled with current bg).
    nodeGraphWaterfallEnsureHold(canvas, width, height, bg);
    nodeGraphWaterfallResetHold(canvas, bg);
  } else if (resized) {
    st.lastW = width;
    st.lastH = height;
    st.edge = Object.create(null);
    // Scale-preserve hold + tapes.
    nodeGraphWaterfallEnsureHold(canvas, width, height, bg);
  }
  st.blend = blend;
  return st;
}

function nodeGraphWaterfallFaceBlur(settings) {
  const n = Number(settings?.faceBlur);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function nodeGraphWaterfallFinishOutputInk(spec, context, canvas, scrollPx) {
  void context;
  void scrollPx;
  const face = spec?.canvas || canvas;
  if (typeof paintNodeGraphFaceInkOverlay !== "function") {
    return;
  }
  const def = typeof nodeGraphModuleDefinitions === "object"
    ? nodeGraphModuleDefinitions[spec?.slot?.type]
    : null;
  // Output pause/protect marks + RMS guides: GL, inside the waterfall present
  // (nodeGraphFaceInkDraw). This arms the face; the present draws it.
  const inked = paintNodeGraphFaceInkOverlay(face, spec?.slot, spec?.settings, spec?.density, {
    rmsDbGuides: Boolean(def?.rmsDbGuides) && !spec?.cold,
  });
  // Fade frames burn the mark into the history, then re-present.
  if (inked?._outputInkBake && typeof nodeGraphWaterfallGlStampInk === "function") {
    nodeGraphWaterfallGlStampInk(face);
    nodeGraphWaterfallGlPresent(face, spec?.bg || "#000000");
  }
}


/**
 * History column count from the circuit-builder face, not from a fixed
 * frame sample and not from device pixels.
 * base = round(layoutCssWidth * pixelDensity). pixelDensity is the
 * module-face plate density (0..1) that sizes the layout canvas.
 * Detail (0..1, default 1) scales that: columns = max(1, round(base * detail)).
 * 1 = one bar per layout pixel (max). barPx = backingStoreWidth / columns.
 * The bar fillRects that column times barThickness (1 = full, 0 = none).
 * At detail 1 the stamp interpolates between those column values.
 */
function nodeGraphWaterfallDetail(settings) {
  const raw = Number(settings?.detail);
  const detail = Number.isFinite(raw) ? raw : 1;
  const lo = typeof NODE_GRAPH_WATERFALL_DETAIL_MIN === "number" ? NODE_GRAPH_WATERFALL_DETAIL_MIN : 0;
  const hi = typeof NODE_GRAPH_WATERFALL_DETAIL_MAX === "number" ? NODE_GRAPH_WATERFALL_DETAIL_MAX : 1;
  return Math.max(lo, Math.min(hi, detail));
}

/** Detail 1 joins column edges. Below 1, columns stay independent flat bars. */
function nodeGraphWaterfallDetailConnects(settings) {
  return nodeGraphWaterfallDetail(settings) >= 0.999;
}

function nodeGraphWaterfallLayoutColumns(spec, canvas, settings) {
  const density = typeof nodeGraphFacePlateDensity === "function"
    ? nodeGraphFacePlateDensity(settings, nodeGraphFiniteNumber(spec?.density, 1))
    : Math.max(0, Math.min(1, nodeGraphFiniteNumber(
      spec?.density,
      nodeGraphFiniteNumber(settings?.pixelDensity, 1),
    )));
  const screen = spec?.item?.screenElement || spec?.slot?.scopeElement || null;
  let cssW = 0;
  if (screen && typeof ensureFaceMetrics === "function") {
    const metrics = ensureFaceMetrics(screen, { observe: false });
    cssW = Number(metrics?.cssW || metrics?.cssWidth || 0);
  }
  const dpr = Math.max(1, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  const backing = Math.max(1, Math.floor(nodeGraphFiniteNumber(canvas?.width, 1)));
  if (!(cssW > 0)) {
    const den = density > 1e-6 ? density : 1;
    cssW = backing / (dpr * den);
  }
  cssW = Math.max(1, cssW);
  const baseColumns = Math.max(1, Math.round(cssW * density));
  const detail = nodeGraphWaterfallDetail(settings);
  const columns = Math.max(1, Math.round(baseColumns * detail));
  const barPx = backing / columns;
  return { columns, barPx, density, cssW, detail };
}


/** Peak-to-peak Y for one open column accumulator. Silent columns draw nothing. */
function nodeGraphWaterfallAccBarYs(acc, buffer, slot, settings, height) {
  const bottomFill = nodeGraphWaterfallIsBottomFill(settings);
  if (!acc?.has || (!bottomFill && nodeGraphWaterfallExtentIsSilent(acc.min, acc.max))) {
    return null;
  }
  const live = nodeGraphWaterfallPrepare(buffer, settings) || buffer;
  const amp = nodeGraphWaterfallAmp(live, slot);
  const excursion = nodeGraphWaterfallExcursionBar(acc.min, acc.max, amp);
  const midY = height * 0.5;
  const halfHeight = nodeGraphWaterfallHalfHeight(height, slot, settings, amp);
  // Bottom fill: from the bottom edge up to the column max (stroke stays min..max).
  const yMin = bottomFill ? height : nodeGraphWaterfallY(excursion.min, amp.gain, amp.offset, midY, halfHeight, amp, settings);
  const yMax = nodeGraphWaterfallY(bottomFill ? acc.max : excursion.max, amp.gain, amp.offset, midY, halfHeight, amp, settings);
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    return null;
  }
  let y0 = Math.min(yMin, yMax);
  let y1 = Math.max(yMin, yMax);
  if (y1 - y0 < 1) {
    const mid = (y0 + y1) * 0.5;
    y0 = mid - 0.5;
    y1 = mid + 0.5;
  }
  // Stroke follows the signal's own min/max. Fill may extend a one-sided
  // column to 0, and that rest edge is the face center — not a bar edge.
  const rawMin = nodeGraphWaterfallY(acc.min, amp.gain, amp.offset, midY, halfHeight, amp, settings);
  const rawMax = nodeGraphWaterfallY(acc.max, amp.gain, amp.offset, midY, halfHeight, amp, settings);
  let strokeY0 = y0;
  let strokeY1 = y1;
  if (Number.isFinite(rawMin) && Number.isFinite(rawMax)) {
    strokeY0 = Math.min(rawMin, rawMax);
    strokeY1 = Math.max(rawMin, rawMax);
    if (strokeY1 - strokeY0 < 1) {
      const mid = (strokeY0 + strokeY1) * 0.5;
      strokeY0 = mid - 0.5;
      strokeY1 = mid + 0.5;
    }
  }
  return { y0, y1, strokeY0, strokeY1 };
}

/**
 * Move history by `advancePx` (sub-column / fractional). Stamp filled bars on
 * the right. Only the open detail column is repainted — not the whole face.
 * Returns the pixel fill of the still-open column (0 if one just completed).
 */
function nodeGraphWaterfallSmoothAdvance(destCtx, destCanvas, spec, options) {
  const width = destCanvas.width;
  const height = destCanvas.height;
  const settings = spec.settings || {};
  const advancePx = Math.max(0, nodeGraphFiniteNumber(options?.advancePx));
  const barPx = Math.max(1e-6, nodeGraphFiniteNumber(options?.barPx, 1));
  const sampleStart = Math.floor(nodeGraphFiniteNumber(options?.sampleStart));
  const sampleEnd = Math.floor(nodeGraphFiniteNumber(options?.sampleEnd));
  let colPx = Math.max(0, nodeGraphFiniteNumber(options?.colPx));
  if (colPx >= barPx) colPx = 0;
  const barAccMap = options?.barAcc || Object.create(null);
  const mode = nodeGraphWaterfallBlendMode(settings, { rgbGuns: Boolean(spec?.rgbBuffers) });
  const plateBg = mode === "multiply" ? "#ffffff" : (spec.bg || "#000000");
  if (!nodeGraphWaterfallEnsureHold(destCanvas, width, height, plateBg)) {
    return colPx;
  }
  const scroll = options?.scroll !== false;
  const paintPx = Math.max(0, Math.round(advancePx));
  if (scroll && paintPx >= 1) {
    nodeGraphWaterfallScrollHold(destCanvas, paintPx, plateBg);
    // The plate moved left by paintPx; move each channel's last stroke point
    // with it. Left stale, the next column's connector (the vertical jump of
    // a held step at a frame boundary) started paintPx too far right and the
    // following column clears erased it, so the jump was skipped.
    const strokeBag = destCanvas._waterfall;
    if (strokeBag?.strokePts) {
      for (const k of Object.keys(strokeBag.strokePts)) {
        const pts = strokeBag.strokePts[k];
        if (!Array.isArray(pts)) continue;
        strokeBag.strokePts[k] = pts.map((q) => ({ x: q.x - paintPx, y: q.y }));
      }
    }
    // The recent columns kept for the stroke redraw move with the plate too.
    if (Array.isArray(strokeBag?.recentCols)) {
      for (const c of strokeBag.recentCols) c.x -= paintPx;
    }
  }
  const channels = nodeGraphWaterfallChannelList(spec, settings).filter((ch) => ch.enabled !== false);
  if (!channels.length || paintPx < 1) {
    nodeGraphWaterfallPresentHold(destCtx, destCanvas, plateBg);
    return 0;
  }
  let stampComposite = "source-over";
  if (mode === "lighter" || mode === "screen") stampComposite = mode;
  else if (mode === "multiply" || mode === "difference" || mode === "exclusion" || mode === "xor") {
    stampComposite = mode;
  } else if (mode === "combine" || mode === "meet") {
    stampComposite = "lighter";
  }
  const connectEdge = nodeGraphWaterfallDetailConnects(settings)
    && nodeGraphWaterfallBarThickness(settings) >= 0.999;
  const edgeMap = connectEdge
    ? (destCanvas._waterfall.edge || (destCanvas._waterfall.edge = Object.create(null)))
    : null;
  const sampleSpan = Math.max(0, sampleEnd - sampleStart);
  const pix0 = Math.max(0, width - paintPx);
  const useFill = nodeGraphWaterfallBarsFilled(settings);
  const useStroke = nodeGraphWaterfallDrawStroke(settings);
  const bag = destCanvas._waterfall || (destCanvas._waterfall = {});
  // Stroke layering: a thick, antialiased stroke reaches past its column, and
  // channels were stroked column by column (L, R, L, R ...), so in each
  // column L could land on top of the previous column's R: the overlap order
  // flickered along the line. Now the last `reach` columns stay open: each
  // frame they are cleared with the new strip, their fills restamped from
  // the kept spans, then every channel strokes the whole open strip in
  // channel order (L, then R on top). Columns left of the strip are final.
  let redo = [];
  if (useStroke && scroll && bag.recentW === width && Array.isArray(bag.recentCols)) {
    const { reach } = nodeGraphWaterfallStrokeReach(destCanvas, settings);
    redo = bag.recentCols.filter((c) => c.x >= pix0 - reach && c.x < pix0);
  }
  const clipX0 = redo.length ? redo[0].x : pix0;
  if (typeof nodeGraphWaterfallGlClearColumn === "function" && width > clipX0) {
    nodeGraphWaterfallGlClearColumn(destCanvas, clipX0, width - clipX0, plateBg);
  }
  for (const c of redo) {
    nodeGraphWaterfallStampColumnFills(destCanvas, c.x, c.spans, mode, stampComposite, useFill);
  }
  const strokeCols = Object.create(null);
  const recent = [];
  for (let x = pix0; x < width; x += 1) {
    const t0 = (x - pix0) / paintPx;
    const t1 = (x + 1 - pix0) / paintPx;
    const s0 = sampleStart + sampleSpan * t0;
    const s1 = sampleStart + sampleSpan * Math.max(t1, t0 + 1e-6);
    const columnSpans = [];
    for (let i = 0; i < channels.length; i += 1) {
      const ch = channels[i];
      let acc = barAccMap[ch.lastYKey];
      if (!acc) {
        acc = nodeGraphWaterfallAccMake();
        barAccMap[ch.lastYKey] = acc;
      }
      nodeGraphWaterfallAccReset(acc);
      const buf = nodeGraphWaterfallPrepare(ch.buffer, settings);
      const mapped = nodeGraphWaterfallMapSampleWindow(
        spec.buffer, buf, s0, Math.max(s0 + 1e-6, s1),
      );
      if (mapped) {
        nodeGraphWaterfallAccPush(acc, buf, mapped.start, mapped.end, settings, spec.slot);
      }
      const ys = mapped
        ? nodeGraphWaterfallAccBarYs(acc, ch.buffer, spec.slot, settings, height)
        : null;
      const key = ch.lastYKey || String(i);
      if (!ys && edgeMap) delete edgeMap[key];
      columnSpans.push({
        key,
        ys,
        waveYs: useStroke && mapped ? nodeGraphWaterfallWaveYs(acc, ch.buffer, spec.slot, settings, height) : null,
        prevEdge: connectEdge && edgeMap ? edgeMap[key] : null,
        strokeColor: ch.strokeColor,
        // Brightness = ink alpha (4th entry), like the bar path.
        rgb: [...nodeGraphWaterfallParseInkRgb(ch.color), nodeGraphWaterfallClamp01(ch.bright ?? 1, 1)],
      });
    }
    nodeGraphWaterfallStampColumnFills(
      destCanvas, x, columnSpans, mode, stampComposite, useFill,
    );
    if (useStroke) recent.push({ x, spans: columnSpans });
    for (let i = 0; i < columnSpans.length; i += 1) {
      const span = columnSpans[i];
      // Stroke does not depend on the fill (see the onset path): collected
      // here, drawn per channel after all fills.
      if (useStroke) {
        const run = strokeCols[span.key] || (strokeCols[span.key] = { color: span.strokeColor, cols: [] });
        run.cols.push({ x, ys: span.waveYs });
      }
      const ys = span.ys;
      if (!ys) continue;
      if (edgeMap) edgeMap[span.key] = { y0: ys.y0, y1: ys.y1 };
    }
  }
  if (useStroke) {
    // Channel order = z order: the first channel (L) first, later ones (R) on top.
    for (const key of Object.keys(strokeCols)) {
      // Draw the waveform (both peaks + last sample), not a one-sided edge.
      nodeGraphWaterfallStrokeWaveRun(destCanvas, bag, key, strokeCols[key].cols, settings, strokeCols[key].color, clipX0);
    }
    const { reach } = nodeGraphWaterfallStrokeReach(destCanvas, settings);
    bag.recentCols = redo.concat(recent).filter((c) => c.x >= width - reach - 1);
    bag.recentW = width;
  } else {
    bag.recentCols = null;
  }
  nodeGraphWaterfallPresentHold(destCtx, destCanvas, plateBg);
  return 0;
}

function nodeGraphWaterfallPaint(spec) {
  const canvas = spec?.canvas;
  const context = spec?.context;
  const settings = spec?.settings;
  // WebGL faces pass context=null (drawNodeGraphTraceDisplayCanvasItem).
  // Requiring a 2D context made paint return false, and the caller then
  // cold-reset the plate every frame, so a running signal stayed blank.
  if (!canvas || !settings) return false;
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  const live = nodeGraphWaterfallLiveBuffer(spec, settings);
  if (!live?.length) return false;
  const plateCss = typeof nodeGraphWaterfallPlateCss === "function"
    ? nodeGraphWaterfallPlateCss(settings, "#000000")
    : (spec.settings?.backgroundColor || spec.settings?.background || spec.bg || "#000000");
  spec.bg = plateCss;
  const onsetDef = typeof nodeGraphModuleDefinitions === "object"
    ? nodeGraphModuleDefinitions[spec?.slot?.type]
    : null;
  if (onsetDef?.onsetPark === true) {
    return nodeGraphOnsetPaint(spec, live);
  }

  const blendMode = nodeGraphWaterfallBlendMode(settings, { rgbGuns: Boolean(spec?.rgbBuffers) });
  const st = nodeGraphWaterfallState(
    canvas, width, height, false, spec.bg, context, blendMode,
  );
  const writeSpec = {
    slot: spec.slot,
    settings,
    buffer: live,
    bg: spec.bg,
    stereoBuffers: spec.stereoBuffers,
    xyzBuffers: spec.xyzBuffers,
    rgbBuffers: spec.rgbBuffers,
  };
  const remember = () => {
    if (typeof rememberNodeGraphTraceDisplaySignature === "function") {
      rememberNodeGraphTraceDisplaySignature(spec.slot, spec.item, live, settings);
    }
  };

  const frozen = typeof scopePaintIsFrozen === "function" && scopePaintIsFrozen();
  // Transport pause holds the plate. The first playing frame drops the cursor:
  // leaving lastAbs glued at the pre-pause absolute frame made the undrawn
  // count stay 0 after Play, so Output and Vibrato looked stuck in pause.
  // History-at-0 is not a transport hold and must not clear the cursor.
  if (frozen) st.transportHeld = true;
  if (!frozen && st.transportHeld) {
    st.transportHeld = false;
    st.lastAbs = Number.NaN;
    st.frac = 0;
    st.colPx = 0;
    st.pxCarry = 0;
    st.barAcc = Object.create(null);
  }
  const window = nodeGraphWaterfallUndrawn(live, st.lastAbs);
  if (!Number.isFinite(st.lastAbs) && Number.isFinite(window.absEnd) && window.count > 0) {
    st.lastAbs = Math.max(0, window.absEnd - window.count);
  }
  const ampScale = nodeGraphWaterfallDisplayScale(settings);
  const scaleChanged = Number.isFinite(st.paintScale)
    && Math.abs(st.paintScale - ampScale) > 1e-5;
  st.paintScale = ampScale;
  const silenceHold = nodeGraphWaterfallPauseOnSilence(settings)
    && nodeGraphWaterfallIncomingIsSilent(writeSpec, settings, window, live);
  // Reprint the visible history at the new scale. A silence hold already ate
  // that window, so leave the held picture alone.
  if (scaleChanged && !silenceHold) st.reprint = true;

  // Transport freeze keeps the plate. History 0 uses the same advance path.
  if (frozen && !st.reprint) {
    nodeGraphWaterfallPresentHold(context, canvas, spec.bg);
    nodeGraphWaterfallFinishOutputInk(spec, context, canvas, 0);
    remember();
    return true;
  }

  const history = nodeGraphWaterfallHistorySeconds(settings);
  // Pause on silence: keep the hold. No scroll, no new columns.
  // Eat the silent window so it does not burst-scroll when sound returns.
  if (silenceHold && !st.reprint) {
    if (Number.isFinite(window.absEnd) && window.count > 0) {
      st.lastAbs = window.absEnd;
    }
    nodeGraphWaterfallPresentHold(context, canvas, spec.bg);
    nodeGraphWaterfallFinishOutputInk(spec, context, canvas, 0);
    remember();
    return true;
  }
  const hz = nodeGraphWaterfallVisualHz(live);

  // Seconds across the face, in samples. Not an integer column count:
  // rounding that count, or clamping a long frame into width-1, paints a
  // different history than the plate and the two alternate. Below one
  // sample the face is that sample — history 0 included, no separate branch.
  const faceCols = nodeGraphWaterfallLayoutColumns(spec, canvas, settings);
  const barPx = Math.max(1e-6, faceCols.barPx);
  const faceSamples = Math.max(hz * Math.max(history, 0), 1);
  const arrived = Math.max(0, window.count);
  let shown = Math.min(arrived, faceSamples);
  let sampleStart = window.start;
  let sampleEnd = window.end;
  if (st.reprint) {
    const end = live.length || 0;
    const recent = Math.max(0, Math.floor(nodeGraphFiniteNumber(live.nodeGraphScopeRecentSampleCount)));
    const available = recent > 0 ? Math.min(end, recent) : end;
    const want = Math.min(available, faceSamples);
    const canRebuild = want > 0 && (want + 1e-6 >= faceSamples || faceSamples <= 1);
    if (!canRebuild) {
      st.reprint = false;
    } else {
    sampleEnd = end;
    sampleStart = Math.max(0, end - want);
    shown = want;
    st.reprint = false;
    st.edge = Object.create(null);
    st.barAcc = Object.create(null);
    st.pxCarry = 0;
    st.colPx = 0;
    st.frac = 0;
    st.carrySamples = 0;
    if (st.strokePts) st.strokePts = Object.create(null);
    st.recentCols = null;
    const blend = nodeGraphWaterfallBlendMode(settings, { rgbGuns: Boolean(spec?.rgbBuffers) });
    const plateBg = blend === "multiply" ? "#ffffff" : (spec.bg || "#000000");
    if (typeof nodeGraphWaterfallGlReset === "function") {
      nodeGraphWaterfallGlReset(canvas, plateBg);
    }
    nodeGraphWaterfallResetHold(canvas, plateBg);
    }
  }
  if (shown + 1e-9 < arrived) {
    sampleStart = Math.max(0, sampleEnd - shown);
  }
  // One sample has no span. A point stays a plateau (a step is not a ramp).
  if (shown > 0 && shown <= 1 && sampleEnd > 0) {
    const i = Math.max(0, sampleEnd - 1);
    sampleStart = i;
    sampleEnd = i;
  }
  let advancePx = (shown / faceSamples) * width;
  if (advancePx > width) advancePx = width;
  const maxPx = Math.max(1, width);
  if (advancePx >= width - 1e-3) {
    st.colPx = 0;
    st.pxCarry = 0;
    st.carrySamples = 0;
    st.barAcc = Object.create(null);
    st.edge = Object.create(null);
  }
  // Time step is advancePx. The plate commits whole texels; the remainder
  // is uSub so a fat detail column is not the scroll quantum.
  const framePx = advancePx;
  st.pxCarry = nodeGraphFiniteNumber(st.pxCarry) + framePx;
  let movePx = Math.floor(st.pxCarry + 1e-6);
  if (movePx < 0) movePx = 0;
  if (movePx > maxPx) movePx = maxPx;
  const leadPx = Math.max(0, movePx - framePx);
  st.pxCarry = Math.max(0, st.pxCarry - movePx);
  canvas._wfSubPx = st.pxCarry;
  canvas._wfBlur = nodeGraphWaterfallFaceBlur(settings);

  if (!(movePx >= 1)) {
    const channels = nodeGraphWaterfallChannelList(writeSpec, settings)
      .filter((ch) => ch.enabled !== false);
    for (const ch of channels) {
      let acc = st.barAcc[ch.lastYKey];
      if (!acc) {
        acc = nodeGraphWaterfallAccMake();
        st.barAcc[ch.lastYKey] = acc;
      }
      const buf = nodeGraphWaterfallPrepare(ch.buffer, settings);
      const end = live.length || 0;
      const start = Math.max(0, end - Math.max(0, window.count));
      const mapped = nodeGraphWaterfallMapSampleWindow(live, buf, start, end);
      if (mapped) {
        nodeGraphWaterfallAccPush(acc, buf, mapped.start, mapped.end, settings, spec.slot);
      }
    }
    st.frac = 0;
    // Sub-pixel frame: no column yet. Remember how many samples it held so
    // the next column covers them too (SmoothAdvance resets the per-column
    // accumulator, so without this their peaks were dropped and the stroke
    // skipped tops / bottoms intermittently).
    st.carrySamples = nodeGraphFiniteNumber(st.carrySamples) + Math.max(0, sampleEnd - sampleStart);
    if (Number.isFinite(window.absEnd) && window.count > 0) {
      st.lastAbs = window.absEnd;
    }
    nodeGraphWaterfallPresentHold(context, canvas, spec.bg);
    nodeGraphWaterfallFinishOutputInk(spec, context, canvas, 0);
    remember();
    return true;
  }

  // Columns span this frame plus any sub-pixel frames since the last column.
  if (nodeGraphFiniteNumber(st.carrySamples) > 0) {
    sampleStart = Math.max(0, sampleStart - Math.floor(st.carrySamples));
  }
  st.carrySamples = 0;
  st.frac = 0;
  if (Number.isFinite(window.absEnd) && window.count > 0) {
    st.lastAbs = window.absEnd;
  }
  st.colPx = nodeGraphWaterfallSmoothAdvance(context, canvas, writeSpec, {
    advancePx: movePx,
    barPx,
    sampleStart,
    sampleEnd,
    colPx: st.colPx,
    barAcc: st.barAcc,
    leadPx,
  });
  nodeGraphWaterfallFinishOutputInk(spec, context, canvas, movePx);
  remember();
  return true;
}
