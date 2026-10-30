// Scope sync: the one rule every syncing scope uses (1D Plot, 1D Plot Stereo,
// 2D Plot, 1D Trace, 1D Phosphor). Single source of truth: change sync here.
//
// Window (what one pass / window shows), Sync on or off:
//   Cycles (default, 3): a fixed number of periods. The period is measured
//          from the time between edges (median of the last few, smoothed);
//          until one is measured, Time is used.
//   Time:  a fixed length in ms; more cycles show as the pitch rises.
// Both values are stored (windowCycles, timeMs), so switching keeps them.
//
//   Free: passes run back to back (a pen wraps; a window is the newest one).
//   Sync: a pass starts on a rising edge. A pen that reaches the right edge
//         waits there for the next edge (holdoff = one pass); a window starts
//         on the latest edge that still fits a whole window. No edge for a
//         whole pass: run free (scope "auto"), so silence or DC never freezes.
//
// Edge:
//   Trig / Reset jack wired: upward zero crossing (gate_hit, trigger.h).
//   Signal: Schmitt trigger through an auto level = the middle of the recent
//   range, hysteresis NODE_GRAPH_SCOPE_SYNC_HYSTERESIS of that range, both
//   smoothed across frames. Hysteresis stops noise / harmonics re-triggering;
//   the smoothed level stops the level (and so the edge) wandering per frame.
//   Edges are interpolated to the sub-sample, so the picture does not jitter
//   by up to one sample per frame.

(function initNodeGraphScopeSync(global) {
  const TIME_MS_MIN = 0.1;
  const TIME_MS_MAX = 10000;
  const TIME_MS_DEFAULT = 20;
  const CYCLES_MIN = 0.05;
  const CYCLES_MAX = 100;
  const CYCLES_DEFAULT = 3;
  const WINDOW_MODES = Object.freeze(["cycles", "time"]);
  const WINDOW_MODE_DEFAULT = "cycles";
  // Fraction of the recent peak-to-peak range.
  const HYSTERESIS = 0.04;
  // Per-frame one-pole for the auto level / hysteresis.
  const LEVEL_SMOOTH = 0.25;
  // A window looks this many windows back for its edge.
  const SEARCH_WINDOWS = 4;
  // Level range span (samples): one pass, at least this, at most the cap.
  const LEVEL_SPAN_MIN = 2048;
  const LEVEL_SPAN_MAX = 32768;
  // Period: median of this many edge intervals; small changes glide (no
  // per-frame zoom wobble), a real pitch change (> PERIOD_SNAP) snaps.
  const PERIOD_INTERVALS = 7;
  const PERIOD_SNAP = 0.03;
  const PERIOD_GLIDE = 0.15;

  function nodeGraphScopeClampTimeMs(value, fallback = TIME_MS_DEFAULT) {
    const n = Number(value);
    const v = Number.isFinite(n) ? n : Number(fallback);
    return Math.max(TIME_MS_MIN, Math.min(TIME_MS_MAX, Number.isFinite(v) ? v : TIME_MS_DEFAULT));
  }

  function nodeGraphScopeClampWindowCycles(value, fallback = CYCLES_DEFAULT) {
    const n = Number(value);
    const v = Number.isFinite(n) ? n : Number(fallback);
    return Math.max(CYCLES_MIN, Math.min(CYCLES_MAX, Number.isFinite(v) ? v : CYCLES_DEFAULT));
  }

  function nodeGraphScopeWindowMode(value, fallback = WINDOW_MODE_DEFAULT) {
    const mode = String(value ?? "").toLowerCase();
    return WINDOW_MODES.includes(mode) ? mode : fallback;
  }

  /** The window settings of any syncing scope's Display Settings bag. */
  function nodeGraphScopeWindowSettings(source, defaults = {}) {
    return {
      windowMode: nodeGraphScopeWindowMode(source?.windowMode, nodeGraphScopeWindowMode(defaults.windowMode)),
      windowCycles: nodeGraphScopeClampWindowCycles(source?.windowCycles, defaults.windowCycles ?? CYCLES_DEFAULT),
      timeMs: nodeGraphScopeClampTimeMs(source?.timeMs, defaults.timeMs ?? TIME_MS_DEFAULT),
    };
  }

  /** Samples in a Time window (>= 2). */
  function nodeGraphScopeTimeSamples(timeMs, sampleRate) {
    const rate = Number(sampleRate) > 0 ? Number(sampleRate) : 48000;
    return Math.max(2, Math.round((nodeGraphScopeClampTimeMs(timeMs) / 1000) * rate));
  }

  /** Cycles to show, or 0 for a Time window. */
  function nodeGraphScopeWindowCycles(settings) {
    return nodeGraphScopeWindowMode(settings?.windowMode) === "cycles"
      ? nodeGraphScopeClampWindowCycles(settings?.windowCycles)
      : 0;
  }

  /** Samples in one pass / window: cycles x measured period, else Time. */
  function nodeGraphScopePassSamples(state, settings, sampleRate) {
    const cycles = nodeGraphScopeWindowCycles(settings);
    if (cycles > 0 && state?.period > 0) return Math.max(2, cycles * state.period);
    return nodeGraphScopeTimeSamples(settings?.timeMs, sampleRate);
  }

  /** Per-face sync state (level, hysteresis, Schmitt arm, period, pen). Kept on the face canvas. */
  function nodeGraphScopeSyncState(holder) {
    const fresh = () => ({ level: NaN, hyst: NaN, armed: false, period: 0, intervals: [], clock: 0, lastEdge: NaN });
    if (!holder) return fresh();
    if (!holder._scopeSync) holder._scopeSync = fresh();
    return holder._scopeSync;
  }

  /**
   * Edge level for this frame. trigger = a Trig / Reset jack: fixed 0 / no
   * hysteresis (gate_hit). Else the smoothed middle of buffer[from..to).
   */
  function nodeGraphScopeSyncLevel(state, buffer, from, to, trigger) {
    if (trigger) return { level: 0, hyst: 0 };
    let lo = Infinity;
    let hi = -Infinity;
    const a = Math.max(0, Math.floor(from));
    const b = Math.min(buffer?.length || 0, Math.ceil(to));
    for (let i = a; i < b; i += 1) {
      const v = buffer[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!(hi >= lo)) return { level: Number.isFinite(state.level) ? state.level : 0, hyst: Number.isFinite(state.hyst) ? state.hyst : 0 };
    const mid = (lo + hi) * 0.5;
    const hyst = Math.max(1e-6, (hi - lo) * HYSTERESIS);
    if (!Number.isFinite(state.level)) {
      state.level = mid;
      state.hyst = hyst;
    } else {
      state.level += (mid - state.level) * LEVEL_SMOOTH;
      state.hyst += (hyst - state.hyst) * LEVEL_SMOOTH;
    }
    return { level: state.level, hyst: state.hyst };
  }

  /** Span of recent samples the level is measured over (pen scopes). */
  function nodeGraphScopeSyncLevelSpan(passSamples, chunk) {
    return Math.min(LEVEL_SPAN_MAX, Math.max(LEVEL_SPAN_MIN, Math.ceil(passSamples) | 0, chunk | 0));
  }

  /**
   * One Schmitt step from prev to cur. Arms at or below level - hyst; fires
   * (and disarms) when an armed signal rises above level. Returns where the
   * crossing lies between prev (0) and cur (1), or -1.
   */
  function nodeGraphScopeSyncStep(state, prev, cur, sync) {
    if (!(cur === cur)) return -1;
    if (cur <= sync.level - sync.hyst) state.armed = true;
    if (!state.armed || !(cur > sync.level) || !(prev <= sync.level)) return -1;
    state.armed = false;
    const d = cur - prev;
    const t = d > 0 ? (sync.level - prev) / d : 1;
    return t >= 0 && t <= 1 ? t : 1;
  }

  function median(values) {
    const s = values.slice().sort((x, y) => x - y);
    return s.length ? s[s.length >> 1] : 0;
  }

  /** Fold a measured period (samples) into state.period: glide small changes, snap real ones. */
  function settlePeriod(state, measured) {
    if (!(measured > 2)) return;
    if (!(state.period > 0) || Math.abs(measured - state.period) > state.period * PERIOD_SNAP) {
      state.period = measured;
    } else {
      state.period += (measured - state.period) * PERIOD_GLIDE;
    }
  }

  /**
   * Streaming period tracker (pen scopes): call once per sample with that
   * sample's crossing (edgeT, -1 none). Edge times are sub-sample.
   */
  function nodeGraphScopeSyncTrackPeriod(state, edgeT) {
    state.clock += 1;
    if (edgeT < 0) return;
    const when = state.clock - 1 + edgeT;
    if (Number.isFinite(state.lastEdge)) {
      const interval = when - state.lastEdge;
      if (interval > 2) {
        state.intervals.push(interval);
        if (state.intervals.length > PERIOD_INTERVALS) state.intervals.shift();
        settlePeriod(state, median(state.intervals));
      }
    }
    state.lastEdge = when;
    // Keep the counters small.
    if (state.clock > 1e9) {
      state.clock -= 1e9;
      state.lastEdge -= 1e9;
    }
  }

  /**
   * Window for full-redraw scopes (plots). Buffers are end-aligned; `length`
   * is the common length. opts: { settings, sampleRate, sync, trigger }.
   * Returns { start, n }: start = fractional index into a buffer of `length`
   * samples, n = sample intervals across the window. The caller draws samples
   * floor(start) .. floor(start) + n + 1 (all inside the buffer) shifted left
   * by start - floor(start). Free (or no edge): the newest window.
   */
  function nodeGraphScopeSyncWindow(state, edge, length, opts) {
    const cycles = nodeGraphScopeWindowCycles(opts.settings);
    const timeSamples = nodeGraphScopeTimeSamples(opts.settings?.timeMs, opts.sampleRate);
    const fit = (n) => Math.max(2, Math.min(length - 3, Math.round(n)));
    const freeOf = (n) => ({ start: Math.max(0, length - 2 - n), n });
    if (!(length > 4) || !edge?.length || !(opts.sync || cycles > 0)) return freeOf(fit(timeSamples));
    // Search back over enough samples for SEARCH_WINDOWS windows and the period.
    const guess = cycles > 0 ? (state.period > 0 ? cycles * state.period : LEVEL_SPAN_MAX) : timeSamples;
    const span = Math.min(length - 3, Math.max(LEVEL_SPAN_MIN, Math.ceil(guess * SEARCH_WINDOWS + (state.period || 0) * 2)));
    const offset = edge.length - length;
    const first = Math.max(1, length - 2 - span);
    const level = nodeGraphScopeSyncLevel(state, edge, offset + first - 1, offset + length, opts.trigger);
    // Fresh arm each frame: the search starts from a known state.
    const scan = { armed: false };
    const edges = [];
    let prev = edge[offset + first - 1];
    for (let i = first; i <= length - 2; i += 1) {
      const cur = edge[offset + i];
      const t = nodeGraphScopeSyncStep(scan, prev, cur, level);
      if (t >= 0) edges.push(i - 1 + t);
      prev = cur;
    }
    if (cycles > 0 && edges.length > 2) {
      const intervals = [];
      for (let k = Math.max(1, edges.length - PERIOD_INTERVALS); k < edges.length; k += 1) intervals.push(edges[k] - edges[k - 1]);
      settlePeriod(state, median(intervals));
    }
    const n = fit(cycles > 0 && state.period > 0 ? cycles * state.period : timeSamples);
    if (!opts.sync) return freeOf(n);
    const last = length - 2 - n;
    for (let k = edges.length - 1; k >= 0; k -= 1) {
      if (edges[k] <= last) return { start: edges[k], n };
    }
    return freeOf(n);
  }

  // Pen step results.
  const PEN_DRAW = 0; // draw at pen.phasor, then advance
  const PEN_BREAK_DRAW = 1; // pen jumped (wrap / edge / auto): break the stroke, then draw
  const PEN_BREAK_WAIT = 2; // pass ended under Sync: break the stroke, park at the right edge
  const PEN_WAIT = 3; // parked: draw nothing

  /**
   * Sweeping pen (1D Trace / 1D Phosphor), one sample. pen: { phasor,
   * waiting, waited }; phaseInc = 1 / pass samples; edgeT = this sample's
   * crossing (nodeGraphScopeSyncStep, -1 none). Mid-pass edges are ignored.
   */
  function nodeGraphScopeSyncPenStep(pen, phaseInc, sync, edgeT) {
    if (pen.phasor >= 1 && !pen.waiting) {
      if (!sync) {
        pen.phasor -= Math.floor(pen.phasor);
        return PEN_BREAK_DRAW;
      }
      pen.waiting = true;
      pen.waited = 0;
      pen.phasor = 1;
      if (edgeT < 0) return PEN_BREAK_WAIT;
    }
    if (pen.waiting) {
      if (edgeT >= 0) {
        pen.waiting = false;
        pen.waited = 0;
        pen.phasor = (1 - edgeT) * phaseInc;
        return PEN_BREAK_DRAW;
      }
      pen.waited += 1;
      // Auto: no edge for a whole pass, run free.
      if (pen.waited * phaseInc >= 1) {
        pen.waiting = false;
        pen.waited = 0;
        pen.phasor = 0;
        return PEN_BREAK_DRAW;
      }
      return PEN_WAIT;
    }
    return PEN_DRAW;
  }

  /** Reset jack: pen to the left now (the caller breaks the stroke). */
  function nodeGraphScopeSyncPenRestart(pen) {
    pen.phasor = 0;
    pen.waiting = false;
    pen.waited = 0;
  }

  /** Advance the pen after a draw. */
  function nodeGraphScopeSyncPenAdvance(pen, phaseInc) {
    pen.phasor += phaseInc;
  }

  /** Pen state on a face canvas. */
  function nodeGraphScopeSyncPen(holder) {
    const state = nodeGraphScopeSyncState(holder);
    if (!state.pen) state.pen = { phasor: 0, waiting: false, waited: 0 };
    const p = state.pen;
    if (!Number.isFinite(p.phasor) || p.phasor < 0) p.phasor = 0;
    return p;
  }

  Object.assign(global, {
    NODE_GRAPH_SCOPE_TIME_MS_MIN: TIME_MS_MIN,
    NODE_GRAPH_SCOPE_TIME_MS_MAX: TIME_MS_MAX,
    NODE_GRAPH_SCOPE_TIME_MS_DEFAULT: TIME_MS_DEFAULT,
    NODE_GRAPH_SCOPE_WINDOW_CYCLES_MIN: CYCLES_MIN,
    NODE_GRAPH_SCOPE_WINDOW_CYCLES_MAX: CYCLES_MAX,
    NODE_GRAPH_SCOPE_WINDOW_CYCLES_DEFAULT: CYCLES_DEFAULT,
    NODE_GRAPH_SCOPE_WINDOW_MODE_DEFAULT: WINDOW_MODE_DEFAULT,
    NODE_GRAPH_SCOPE_SYNC_HYSTERESIS: HYSTERESIS,
    NODE_GRAPH_SCOPE_PEN_DRAW: PEN_DRAW,
    NODE_GRAPH_SCOPE_PEN_BREAK_DRAW: PEN_BREAK_DRAW,
    NODE_GRAPH_SCOPE_PEN_BREAK_WAIT: PEN_BREAK_WAIT,
    NODE_GRAPH_SCOPE_PEN_WAIT: PEN_WAIT,
    nodeGraphScopeClampTimeMs,
    nodeGraphScopeClampWindowCycles,
    nodeGraphScopeWindowMode,
    nodeGraphScopeWindowSettings,
    nodeGraphScopeTimeSamples,
    nodeGraphScopeWindowCycles,
    nodeGraphScopePassSamples,
    nodeGraphScopeSyncState,
    nodeGraphScopeSyncLevel,
    nodeGraphScopeSyncLevelSpan,
    nodeGraphScopeSyncStep,
    nodeGraphScopeSyncTrackPeriod,
    nodeGraphScopeSyncWindow,
    nodeGraphScopeSyncPenStep,
    nodeGraphScopeSyncPenRestart,
    nodeGraphScopeSyncPenAdvance,
    nodeGraphScopeSyncPen,
  });
})(typeof window !== "undefined" ? window : globalThis);
